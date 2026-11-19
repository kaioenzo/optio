import { afterEach, describe, expect, it } from "vitest";
import type { ContainerSpec } from "@optio/shared";
import {
  K8sWorkloadManager,
  WORKLOAD_ALLOWED_CAPABILITIES,
  validateWorkloadCapabilities,
} from "./k8s-workload-service.js";

function baseSpec(overrides: Partial<ContainerSpec> = {}): ContainerSpec {
  return {
    image: "optio-agent:latest",
    command: ["/opt/optio/repo-init.sh"],
    env: {},
    workDir: "/workspace",
    labels: { "optio.type": "repo-pod" },
    ...overrides,
  };
}

function buildTemplate(spec: ContainerSpec, restartPolicy: "Always" | "Never" = "Always") {
  const manager = Object.create(K8sWorkloadManager.prototype) as {
    buildPodTemplate: (
      spec: ContainerSpec,
      instanceName: string,
      restartPolicy: "Always" | "Never",
    ) => unknown;
  };
  return manager.buildPodTemplate(spec, "repo-abc", restartPolicy) as any;
}

describe("K8sWorkloadManager security context", () => {
  it("drops capabilities and disables privilege escalation by default", () => {
    const template = buildTemplate(baseSpec());
    const container = template.spec.containers[0];

    expect(container.securityContext.capabilities).toEqual({ drop: ["ALL"] });
    expect(container.securityContext.allowPrivilegeEscalation).toBe(false);
    expect(container.securityContext.seccompProfile).toEqual({ type: "RuntimeDefault" });
  });

  it("allows only capabilities from the workload allowlist", () => {
    const template = buildTemplate(baseSpec({ capabilities: ["SYS_CHROOT"] }));
    const container = template.spec.containers[0];

    expect(container.securityContext.capabilities).toEqual({
      drop: ["ALL"],
      add: ["SYS_CHROOT"],
    });
  });

  it("rejects disallowed capabilities", () => {
    expect(() => buildTemplate(baseSpec({ capabilities: ["SYS_ADMIN"] }))).toThrow(
      "Disallowed container capabilities requested: SYS_ADMIN",
    );
  });

  it("keeps the workload allowlist aligned with Docker-in-Docker needs", () => {
    expect(WORKLOAD_ALLOWED_CAPABILITIES.has("SYS_CHROOT")).toBe(true);
    expect(WORKLOAD_ALLOWED_CAPABILITIES.has("SYS_ADMIN")).toBe(false);
    expect(() => validateWorkloadCapabilities(["SYS_CHROOT"])).not.toThrow();
  });
});

describe("rootless mode (OPTIO_ROOTLESS, issue #532)", () => {
  afterEach(() => {
    delete process.env.OPTIO_ROOTLESS;
  });

  it("default mode keeps the root chown initContainer on StatefulSet pods", () => {
    const template = buildTemplate(baseSpec(), "Always");

    const initNames = (template.spec.initContainers ?? []).map((c: { name: string }) => c.name);
    expect(initNames).toContain("home-perm-fix");
    expect(template.spec.securityContext.runAsNonRoot).toBeUndefined();
    expect(template.spec.securityContext.fsGroupChangePolicy).toBeUndefined();
  });

  it("rootless mode omits the initContainer and hardens the pod security context", () => {
    process.env.OPTIO_ROOTLESS = "true";
    const template = buildTemplate(baseSpec(), "Always");

    const initNames = (template.spec.initContainers ?? []).map((c: { name: string }) => c.name);
    expect(initNames).not.toContain("home-perm-fix");
    expect(template.spec.securityContext).toMatchObject({
      fsGroup: 1001,
      runAsUser: 1001,
      runAsGroup: 1001,
      runAsNonRoot: true,
      fsGroupChangePolicy: "OnRootMismatch",
      seccompProfile: { type: "RuntimeDefault" },
    });
    // No root container remains anywhere in the pod
    for (const c of [...(template.spec.initContainers ?? []), ...template.spec.containers]) {
      expect(c.securityContext?.runAsUser).not.toBe(0);
    }
  });

  it("rootless mode still passes caller-supplied initContainers through", () => {
    process.env.OPTIO_ROOTLESS = "true";
    const template = buildTemplate(
      baseSpec({
        initContainers: [{ raw: { name: "custom-init", image: "busybox" } }],
      }),
      "Always",
    );
    const initNames = (template.spec.initContainers ?? []).map((c: { name: string }) => c.name);
    expect(initNames).toEqual(["custom-init"]);
  });
});

describe("service account token", () => {
  it("never auto-mounts the API token but keeps the ServiceAccount for workload identity", () => {
    const template = buildTemplate(baseSpec({ serviceAccountName: "optio" }));
    expect(template.spec.automountServiceAccountToken).toBe(false);
    expect(template.spec.serviceAccountName).toBe("optio");
  });

  it("disables the automount without a ServiceAccount too", () => {
    const template = buildTemplate(baseSpec(), "Never");
    expect(template.spec.automountServiceAccountToken).toBe(false);
  });
});

describe("ensureStatefulSet on an existing StatefulSet", () => {
  function managerWith(existingImage: string) {
    const replaced: any[] = [];
    const manager = Object.create(K8sWorkloadManager.prototype);
    manager.namespace = "optio";
    manager.ensureHeadlessService = async () => {};
    const existing = {
      spec: { replicas: 1, template: buildTemplate(baseSpec({ image: existingImage })) },
    };
    manager.appsApi = {
      readNamespacedStatefulSet: async () => existing,
      replaceNamespacedStatefulSet: async ({ body }: { body: any }) => replaced.push(body),
    };
    return { manager, replaced };
  }

  it("replaces the pod template when only the agent image changed", async () => {
    const { manager, replaced } = managerWith("optio-agent:old");

    await manager.ensureStatefulSet({
      name: "repo-abc",
      spec: baseSpec({ image: "optio-agent:new" }),
    });

    expect(replaced).toHaveLength(1);
    expect(replaced[0].spec.template.spec.containers[0].image).toBe("optio-agent:new");
  });

  it("leaves an up-to-date StatefulSet alone", async () => {
    const { manager, replaced } = managerWith("optio-agent:latest");

    await manager.ensureStatefulSet({ name: "repo-abc", spec: baseSpec() });

    expect(replaced).toHaveLength(0);
  });
});

describe("Kubernetes object helpers", () => {
  function managerWith(objectApi: Record<string, unknown>) {
    const manager = Object.create(K8sWorkloadManager.prototype);
    manager.namespace = "optio";
    manager.objectApi = objectApi;
    return manager;
  }
  const conflict = Object.assign(new Error("exists"), { code: 409 });
  const notFound = Object.assign(new Error("gone"), { code: 404 });
  const policy = {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: "optio-egress-pod" },
  };

  it("creates an object in the manager's namespace", async () => {
    const created: any[] = [];
    const manager = managerWith({ create: async (spec: any) => created.push(spec) });

    await manager.applyObject(policy);

    expect(created[0].metadata).toEqual({ name: "optio-egress-pod", namespace: "optio" });
  });

  it("patches the object when it already exists", async () => {
    const patched: any[] = [];
    const manager = managerWith({
      create: async () => {
        throw conflict;
      },
      patch: async (spec: any) => patched.push(spec),
    });

    await manager.applyObject(policy);

    expect(patched).toHaveLength(1);
  });

  it("propagates apply failures other than a conflict", async () => {
    const manager = managerWith({
      create: async () => {
        throw new Error("forbidden");
      },
    });

    await expect(manager.applyObject(policy)).rejects.toThrow("forbidden");
  });

  it("leaves an existing object untouched in createObjectIfMissing", async () => {
    const manager = managerWith({
      create: async () => {
        throw conflict;
      },
    });

    await expect(manager.createObjectIfMissing(policy)).resolves.toBeUndefined();
  });

  it("treats deleting a missing object as success", async () => {
    const manager = managerWith({
      delete: async () => {
        throw notFound;
      },
    });

    await expect(
      manager.deleteObject("networking.k8s.io/v1", "NetworkPolicy", "optio-egress-pod"),
    ).resolves.toBeUndefined();
  });

  it("propagates other delete failures", async () => {
    const manager = managerWith({
      delete: async () => {
        throw new Error("forbidden");
      },
    });

    await expect(manager.deleteObject("v1", "ConfigMap", "envoy-config-x")).rejects.toThrow(
      "forbidden",
    );
  });
});
