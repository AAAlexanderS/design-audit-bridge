// Shared schema between sandbox (code.ts), UI (ui.html), and external clients.
// Keep this file dependency-free so it can be copy-pasted to any TS project.
// NOTE: No `export` keywords — this file is compiled as a global script (module: none).

type Risk = "safe" | "risky" | "destructive";

type NodeKind =
  | "node"
  | "page"
  | "component"
  | "variable"
  | "style";

interface Target {
  kind: NodeKind;
  id: string;
  type?: string;
}

interface Cascade {
  kind: "instance" | "bound-style" | "bound-variable" | "font-load";
  count?: number;
  detail?: string;
}

type Operation =
  | RenameOperation
  | SetVariableOperation
  | CreateNodeOperation;

interface CreateNodeOperation {
  id: string;
  verb: "create-node";
  target: Target;
  context?: { page?: string; breadcrumb?: string };
  nodeType: "STICKY" | "RECTANGLE" | "TEXT" | "FRAME";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  fillColor?: { r: number; g: number; b: number };
  reason: string;
  risk: Risk;
  reversible: boolean;
  cascades: Cascade[];
}

interface RenameOperation {
  id: string;
  verb: "rename";
  target: Target;
  context?: {
    page?: string;
    breadcrumb?: string;
  };
  from: string;
  to: string;
  reason: string;
  risk: Risk;
  reversible: boolean;
  cascades: Cascade[];
}

interface SetVariableOperation {
  id: string;
  verb: "set-variable";
  target: Target;
  context?: { page?: string; breadcrumb?: string };
  /** Figma variable ID to bind, e.g. "VariableID:123:456" */
  variableId: string;
  /** Node property to bind: fills | strokes | opacity | cornerRadius | itemSpacing | padding* | width | height */
  property: string;
  from: string;   // description of previous value
  to: string;     // description of new value (variable name)
  reason: string;
  risk: Risk;
  reversible: boolean;
  cascades: Cascade[];
}

interface Plan {
  planId: string;
  title: string;
  summary: string;
  domain: "figma";
  passNumber?: number;
  passTotal?: number;
  operations: Operation[];
  preflight?: Preflight[];
}

interface Preflight {
  kind: "font-load";
  value: { family: string; style: string };
}

type BridgeEvent =
  | { type: "plan.received"; planId: string }
  | { type: "plan.rejected"; planId: string; reason?: string }
  | { type: "plan.dry-run.complete"; planId: string; warnings: Warning[] }
  | { type: "plan.executing"; planId: string; selectedOpIds: string[] }
  | { type: "op.complete"; opId: string; result: string }
  | {
      type: "op.failed";
      opId: string;
      error: string;
      recoverable: boolean;
    }
  | { type: "plan.complete"; planId: string; snapshotId: string }
  | { type: "connection.status"; connected: boolean };

interface Warning {
  opId: string;
  level: "info" | "warning" | "error";
  message: string;
}

interface Snapshot {
  id: string;
  planId: string;
  createdAt: number;
  reverseOps: Operation[];
}

// Messages between UI iframe and sandbox (code.ts).
// Both sides use `postMessage`; this type narrows what can cross the boundary.
type UiToSandbox =
  | { type: "ui.ready" }
  | { type: "ui.request-history" }
  | { type: "ui.zoom-to"; nodeId: string }
  | { type: "ui.dry-run"; planId: string; selectedOpIds: string[] }
  | { type: "ui.apply"; planId: string; selectedOpIds: string[] }
  | { type: "ui.reject"; planId: string }
  | { type: "ui.undo-last" }
  | { type: "ui.plan-from-bridge"; plan: Plan }
  | { type: "ui.connection-status"; connected: boolean }
  | { type: "ui.rpc-request"; rpcId: string; method: string; params: any };

type SandboxToUi =
  | { type: "sandbox.plan"; plan: Plan }
  | { type: "sandbox.history"; entries: HistoryEntry[] }
  | { type: "sandbox.event"; event: BridgeEvent }
  | { type: "sandbox.dry-run-result"; planId: string; warnings: Warning[] }
  | { type: "sandbox.rpc-response"; rpcId: string; result?: any; error?: string };

interface HistoryEntry {
  snapshotId: string;
  planId: string;
  title: string;
  appliedAt: number;
  opCount: number;
  reversible: boolean;
}
