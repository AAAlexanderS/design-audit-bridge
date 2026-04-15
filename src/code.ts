/// <reference types="@figma/plugin-typings" />
/// <reference path="./schema.ts" />
// Sandbox side of the Claude Control Bridge plugin.
// NOTE: WebSocket is NOT available in the Figma plugin sandbox.
//       The UI iframe (ui.html) owns the WebSocket connection.
//       The UI forwards plans here via postMessage and we execute
//       them against the Figma API, then emit events back to the UI.

const HISTORY_KEY = "claude-control-bridge:history";

figma.showUI(__html__, { width: 440, height: 640, themeColors: true });

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  currentPlan: null as Plan | null,
  snapshots: new Map<string, Snapshot>(),
  history: [] as HistoryEntry[],
};

// ---------------------------------------------------------------------------
// History persistence
// ---------------------------------------------------------------------------
async function loadHistory() {
  try {
    const raw = await figma.clientStorage.getAsync(HISTORY_KEY);
    if (Array.isArray(raw)) {
      state.history = raw as HistoryEntry[];
    }
  } catch (e) {
    // First run
  }
}

async function saveHistory() {
  try {
    const toSave = state.history.slice(-50);
    await figma.clientStorage.setAsync(HISTORY_KEY, toSave);
  } catch (e) {
    console.warn("Failed to persist history", e);
  }
}

// ---------------------------------------------------------------------------
// UI messaging
// ---------------------------------------------------------------------------
function toUi(msg: SandboxToUi) {
  figma.ui.postMessage(msg);
}

function emitEvent(event: BridgeEvent) {
  toUi({ type: "sandbox.event", event });
}

// ---------------------------------------------------------------------------
// Messages from UI
// ---------------------------------------------------------------------------
figma.ui.onmessage = async (msg: UiToSandbox) => {
  switch (msg.type) {
    case "ui.ready":
      await loadHistory();
      toUi({ type: "sandbox.history", entries: state.history });
      if (state.currentPlan) {
        toUi({ type: "sandbox.plan", plan: state.currentPlan });
      }
      break;

    case "ui.plan-from-bridge":
      // UI received a plan from the bridge server WebSocket and is forwarding it here
      if (state.currentPlan) {
        // Append new operations to existing plan
        const existingIds = new Set(state.currentPlan.operations.map((op: Operation) => op.id));
        for (const op of msg.plan.operations) {
          if (!existingIds.has(op.id)) state.currentPlan.operations.push(op);
        }
        toUi({ type: "sandbox.plan", plan: state.currentPlan });
      } else {
        state.currentPlan = msg.plan;
        toUi({ type: "sandbox.plan", plan: msg.plan });
      }
      emitEvent({ type: "plan.received", planId: msg.plan.planId });
      figma.notify("Review ready: " + msg.plan.title, { timeout: 4000 });
      break;

    case "ui.zoom-to":
      await zoomTo(msg.nodeId);
      break;

    case "ui.dry-run":
      await dryRun(msg.planId, msg.selectedOpIds);
      break;

    case "ui.apply":
      await applyPlan(msg.planId, msg.selectedOpIds);
      break;

    case "ui.reject":
      if (state.currentPlan && state.currentPlan.planId === msg.planId) {
        emitEvent({ type: "plan.rejected", planId: msg.planId });
        state.currentPlan = null;
      }
      break;

    case "ui.undo-last":
      await undoLast();
      break;

    case "ui.rpc-request":
      await handleRpc(msg.rpcId, msg.method, msg.params);
      break;
  }
};

async function handleRpc(rpcId: string, method: string, params: any) {
  try {
    let result;

    // ── Original RPC methods ────────────────────────────────────────────────

    if (method === "get_selection") {
      const selection = figma.currentPage.selection;
      result = selection.map(node => ({
        id: node.id,
        type: node.type,
        name: node.name
      }));

    } else if (method === "inspect_node") {
      if (!params || !params.nodeId) throw new Error("Missing nodeId");
      const node = await figma.getNodeByIdAsync(params.nodeId);
      if (!node) throw new Error("Node not found");

      function extractStyle(n: BaseNode): Record<string, any> {
        const s: Record<string, any> = {};
        if ("width" in n)        s.width        = (n as any).width;
        if ("height" in n)       s.height       = (n as any).height;
        if ("opacity" in n)      s.opacity      = (n as any).opacity;
        if ("cornerRadius" in n) s.cornerRadius = (n as any).cornerRadius;
        if ("itemSpacing" in n)  s.itemSpacing  = (n as any).itemSpacing;
        if ("paddingLeft" in n)  s.padding      = { left: (n as any).paddingLeft, right: (n as any).paddingRight, top: (n as any).paddingTop, bottom: (n as any).paddingBottom };

        function toHex(c: RGB): string {
          const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
          return "#" + h(c.r) + h(c.g) + h(c.b);
        }
        if ("fills" in n && Array.isArray((n as any).fills)) {
          s.fills = (n as any).fills.map((p: Paint) =>
            p.type === "SOLID" ? { type: "SOLID", color: toHex((p as SolidPaint).color), opacity: (p as SolidPaint).opacity ?? 1 } : { type: p.type }
          );
        }
        if ("strokes" in n && Array.isArray((n as any).strokes)) {
          s.strokes = (n as any).strokes.map((p: Paint) =>
            p.type === "SOLID" ? { type: "SOLID", color: toHex((p as SolidPaint).color) } : { type: p.type }
          );
        }
        if ("fontName" in n) s.fontName = (n as any).fontName;
        if ("fontSize" in n) s.fontSize = (n as any).fontSize;
        if ("fontWeight" in n) s.fontWeight = (n as any).fontWeight;

        // Summarise bound variables (token links)
        const bv = (n as any).boundVariables;
        if (bv && Object.keys(bv).length > 0) {
          s.boundVariables = Object.keys(bv).reduce((acc: Record<string, string>, key) => {
            const ref = Array.isArray(bv[key]) ? bv[key][0] : bv[key];
            if (ref && ref.id) acc[key] = ref.id;
            return acc;
          }, {});
        }
        return s;
      }

      result = {
        id: node.id,
        type: node.type,
        name: node.name,
        style: extractStyle(node),
        children: "children" in node
          ? (node as any).children.map((c: any) => ({ id: c.id, name: c.name, type: c.type }))
          : []
      };

    // ── P1: audit_tokens ────────────────────────────────────────────────────

    } else if (method === "audit_tokens") {
      const maxNodes: number = (params && params.maxNodes) || 500;
      const checkTypes: string[] = (params && params.checkTypes) || ["fills", "strokes"];
      const violations: any[] = [];
      const tokenBound: any[] = [];
      let scanned = 0;

      function rgbToHex(r: number, g: number, b: number): string {
        const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
        return "#" + h(r) + h(g) + h(b);
      }

      function auditNode(node: SceneNode) {
        if (scanned >= maxNodes) return;
        scanned++;
        for (const prop of checkTypes) {
          if (!(prop in node)) continue;
          const paints: Paint[] = (node as any)[prop];
          if (!Array.isArray(paints)) continue;
          paints.forEach((paint: any, idx: number) => {
            if (paint.type !== "SOLID") return;
            const boundVars = (node as any).boundVariables;
            const propBound = boundVars && boundVars[prop];
            const isBound = propBound != null && (
              Array.isArray(propBound) ? propBound[idx] != null : true
            );
            if (isBound) {
              const varRef = Array.isArray(propBound) ? propBound[idx] : propBound;
              tokenBound.push({
                nodeId: node.id, nodeName: node.name, nodeType: node.type,
                property: prop, variableId: varRef && varRef.id, variableName: varRef && varRef.id
              });
            } else {
              violations.push({
                nodeId: node.id, nodeName: node.name, nodeType: node.type,
                property: prop, hardcodedValue: rgbToHex(paint.color.r, paint.color.g, paint.color.b)
              });
            }
          });
        }
        if ("children" in node) {
          for (const child of (node as ChildrenMixin).children) {
            if (scanned >= maxNodes) break;
            auditNode(child as SceneNode);
          }
        }
      }

      for (const node of figma.currentPage.children) {
        if (scanned >= maxNodes) break;
        auditNode(node);
      }
      result = { violations, tokenBound, scanned };

    // ── P2: list_components ─────────────────────────────────────────────────

    } else if (method === "list_components") {
      const includeVariants: boolean = params && params.includeVariants;
      const components: any[] = [];

      function collectComponents(node: BaseNode) {
        if (node.type === "COMPONENT_SET") {
          const cs = node as ComponentSetNode;
          const variantProps: Record<string, string[]> = {};
          if (cs.variantGroupProperties) {
            for (const key of Object.keys(cs.variantGroupProperties)) {
              variantProps[key] = cs.variantGroupProperties[key].values;
            }
          }
          components.push({ id: cs.id, type: "COMPONENT_SET", name: cs.name, description: cs.description || "", variantProperties: variantProps });
          if (includeVariants) {
            for (const child of cs.children) {
              if (child.type === "COMPONENT") {
                const c = child as ComponentNode;
                components.push({ id: c.id, type: "COMPONENT", name: c.name, description: c.description || "", parentSetId: cs.id, variantProperties: c.variantProperties || {} });
              }
            }
          }
        } else if (node.type === "COMPONENT") {
          const c = node as ComponentNode;
          if (!c.parent || c.parent.type !== "COMPONENT_SET") {
            components.push({ id: c.id, type: "COMPONENT", name: c.name, description: c.description || "", variantProperties: {} });
          }
        }
        if ("children" in node) {
          for (const child of (node as ChildrenMixin).children) collectComponents(child);
        }
      }

      for (const node of figma.currentPage.children) collectComponents(node);
      result = components;

    // ── P3: get_all_variables ────────────────────────────────────────────────

    } else if (method === "get_all_variables") {
      const filterCollections: string[] | null = (params && params.collections) || null;
      const collections = await figma.variables.getLocalVariableCollectionsAsync();
      const allVars = await figma.variables.getLocalVariablesAsync();

      const colMap: Record<string, { name: string; defaultModeId: string }> = {};
      for (const col of collections) colMap[col.id] = { name: col.name, defaultModeId: col.defaultModeId };

      // Build a lookup map for all variables to resolve aliases
      const varById: Record<string, Variable> = {};
      for (const v of allVars) varById[v.id] = v;

      function resolveValue(v: Variable, depth = 0): string {
        if (depth > 8) return "(circular)";
        const col = colMap[v.variableCollectionId];
        if (!col) return "";
        const rawValue = v.valuesByMode[col.defaultModeId];
        if (rawValue === null || rawValue === undefined) return "";
        // Resolve VARIABLE_ALIAS recursively
        if (typeof rawValue === "object" && "type" in (rawValue as object) && (rawValue as any).type === "VARIABLE_ALIAS") {
          const aliasId = (rawValue as any).id as string;
          const aliasVar = varById[aliasId];
          if (aliasVar) return resolveValue(aliasVar, depth + 1);
          return "(unresolved alias)";
        }
        if (v.resolvedType === "COLOR" && typeof rawValue === "object" && "r" in (rawValue as object)) {
          const c = rawValue as RGBA;
          const h = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
          return "#" + h(c.r) + h(c.g) + h(c.b);
        }
        if (typeof rawValue === "number") return String(rawValue);
        if (typeof rawValue === "string" || typeof rawValue === "boolean") return String(rawValue);
        return JSON.stringify(rawValue);
      }

      const tokens: any[] = [];
      for (const v of allVars) {
        const col = colMap[v.variableCollectionId];
        if (!col) continue;
        if (filterCollections && !filterCollections.includes(col.name)) continue;
        tokens.push({
          id: v.id,
          path: col.name + "/" + v.name,
          name: v.name,
          collection: col.name,
          type: v.resolvedType,
          resolvedValue: resolveValue(v)
        });
      }
      result = tokens;

    // ── P5: search_components ────────────────────────────────────────────────

    } else if (method === "search_components") {
      const query: string = (params && params.query) ? (params.query as string).toLowerCase() : "";
      const variantFilter: Record<string, string> = (params && params.variantFilter) || {};
      const nodeTypes: string[] = (params && params.nodeTypes) || ["COMPONENT", "COMPONENT_SET"];
      const hasDescription: boolean | undefined = params && params.hasDescription;
      const found: any[] = [];

      function searchNode(node: BaseNode) {
        if (nodeTypes.includes(node.type)) {
          if (query && !node.name.toLowerCase().includes(query)) {
            if ("children" in node) for (const c of (node as ChildrenMixin).children) searchNode(c);
            return;
          }
          const desc: string = (node as any).description || "";
          if (hasDescription === true && !desc) { if ("children" in node) for (const c of (node as ChildrenMixin).children) searchNode(c); return; }
          if (hasDescription === false && desc) { if ("children" in node) for (const c of (node as ChildrenMixin).children) searchNode(c); return; }

          if (Object.keys(variantFilter).length > 0) {
            if (node.type === "COMPONENT_SET") {
              const cs = node as ComponentSetNode;
              const groups = cs.variantGroupProperties || {};
              for (const [k, v] of Object.entries(variantFilter)) {
                if (!groups[k] || !groups[k].values.includes(v)) {
                  for (const c of cs.children) searchNode(c);
                  return;
                }
              }
            } else if (node.type === "COMPONENT") {
              const vp = (node as ComponentNode).variantProperties || {};
              for (const [k, v] of Object.entries(variantFilter)) {
                if (vp[k] !== v) {
                  if ("children" in node) for (const c of (node as ChildrenMixin).children) searchNode(c);
                  return;
                }
              }
            }
          }

          const entry: any = { id: node.id, type: node.type, name: node.name, description: (node as any).description || "" };
          if (node.type === "COMPONENT_SET") {
            const groups = (node as ComponentSetNode).variantGroupProperties || {};
            entry.variantProperties = Object.keys(groups).reduce((acc: any, k) => { acc[k] = groups[k].values; return acc; }, {});
          } else if (node.type === "COMPONENT") {
            entry.variantProperties = (node as ComponentNode).variantProperties || {};
          }
          found.push(entry);
        }
        if ("children" in node) for (const child of (node as ChildrenMixin).children) searchNode(child);
      }

      for (const node of figma.currentPage.children) searchNode(node);
      result = found;

    // ── #1: audit_overrides ──────────────────────────────────────────────────
    // Traverse the current page. For every INSTANCE node, compare its top-level
    // style properties against its mainComponent. Report by severity:
    //   structural — mainComponent is null (detached)
    //   style      — fills/strokes/opacity/cornerRadius differ from master
    //   content    — only text content differs (expected, not reported as violation)

    } else if (method === "audit_overrides") {
      const maxNodes: number = (params && params.maxNodes) || 300;
      const structural: any[] = [];
      const styleViolations: any[] = [];
      let instancesScanned = 0;

      function toHex(c: RGB): string {
        const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
        return "#" + h(c.r) + h(c.g) + h(c.b);
      }

      function serializeFills(fills: readonly Paint[]): string {
        return JSON.stringify(fills.map(p =>
          p.type === "SOLID" ? { t: "S", c: toHex((p as SolidPaint).color), o: Math.round(((p as SolidPaint).opacity ?? 1) * 100) } : { t: p.type }
        ));
      }

      function diffStyles(inst: InstanceNode, master: ComponentNode): string[] {
        const diffs: string[] = [];
        const checks: Array<[string, () => string]> = [
          ["fills",        () => serializeFills((inst as any).fills ?? []) + "|" + serializeFills((master as any).fills ?? [])],
          ["strokes",      () => serializeFills((inst as any).strokes ?? []) + "|" + serializeFills((master as any).strokes ?? [])],
          ["opacity",      () => String((inst as any).opacity) + "|" + String((master as any).opacity)],
          ["cornerRadius", () => String((inst as any).cornerRadius) + "|" + String((master as any).cornerRadius)],
          ["effects",      () => JSON.stringify((inst as any).effects) + "|" + JSON.stringify((master as any).effects)],
          ["blendMode",    () => String((inst as any).blendMode) + "|" + String((master as any).blendMode)],
        ];
        for (const [prop, getValue] of checks) {
          if (!(prop in inst) || !(prop in master)) continue;
          try {
            const [iv, mv] = getValue().split("|");
            if (iv !== mv) diffs.push(prop);
          } catch (_) {}
        }
        return diffs;
      }

      function auditInstance(node: SceneNode) {
        if (instancesScanned >= maxNodes) return;
        if (node.type === "INSTANCE") {
          instancesScanned++;
          const inst = node as InstanceNode;
          if (!inst.mainComponent) {
            structural.push({ nodeId: inst.id, nodeName: inst.name, reason: "mainComponent is null — detached or missing library" });
          } else {
            const diffs = diffStyles(inst, inst.mainComponent);
            if (diffs.length > 0) {
              styleViolations.push({
                nodeId: inst.id,
                nodeName: inst.name,
                masterName: inst.mainComponent.name,
                overriddenProps: diffs,
                severity: diffs.some(d => ["fills", "strokes", "effects"].includes(d)) ? "style" : "cosmetic"
              });
            }
          }
        }
        if ("children" in node) {
          for (const child of (node as ChildrenMixin).children) {
            if (instancesScanned >= maxNodes) break;
            auditInstance(child as SceneNode);
          }
        }
      }

      for (const node of figma.currentPage.children) {
        if (instancesScanned >= maxNodes) break;
        auditInstance(node);
      }
      result = { structural, styleViolations, instancesScanned };

    // ── #5: get_component_snapshot ───────────────────────────────────────────
    // Walk all COMPONENT and COMPONENT_SET nodes. Capture enough state to
    // detect future breaking changes: name, description, variant properties,
    // key style attributes, and Code Connect presence indicator.

    } else if (method === "get_component_snapshot") {
      function toHex2(c: RGB): string {
        const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
        return "#" + h(c.r) + h(c.g) + h(c.b);
      }

      function snapshotStyles(node: ComponentNode): Record<string, any> {
        const s: Record<string, any> = {};
        if ("cornerRadius" in node) s.cornerRadius = (node as any).cornerRadius;
        if ("opacity" in node) s.opacity = (node as any).opacity;
        if ("itemSpacing" in node) s.itemSpacing = (node as any).itemSpacing;
        if ("paddingLeft" in node) s.padding = { l: (node as any).paddingLeft, r: (node as any).paddingRight, t: (node as any).paddingTop, b: (node as any).paddingBottom };
        if ("fills" in node && Array.isArray((node as any).fills)) {
          s.fills = (node as any).fills
            .filter((p: Paint) => p.type === "SOLID")
            .map((p: SolidPaint) => toHex2(p.color));
        }
        if ("width" in node) s.width = (node as any).width;
        if ("height" in node) s.height = (node as any).height;
        return s;
      }

      const snapshot: any[] = [];

      function collectSnapshot(node: BaseNode) {
        if (node.type === "COMPONENT_SET") {
          const cs = node as ComponentSetNode;
          const variantProps: Record<string, string[]> = {};
          if (cs.variantGroupProperties) {
            for (const k of Object.keys(cs.variantGroupProperties)) {
              variantProps[k] = [...cs.variantGroupProperties[k].values].sort();
            }
          }
          snapshot.push({
            id: cs.id, type: "COMPONENT_SET", name: cs.name,
            description: cs.description || "",
            variantProperties: variantProps,
            variantCount: cs.children.length,
          });
          for (const child of cs.children) collectSnapshot(child);
        } else if (node.type === "COMPONENT") {
          const c = node as ComponentNode;
          snapshot.push({
            id: c.id, type: "COMPONENT", name: c.name,
            description: c.description || "",
            variantProperties: c.variantProperties || {},
            styles: snapshotStyles(c),
            parentSetId: (c.parent && c.parent.type === "COMPONENT_SET") ? c.parent.id : null,
          });
        }
        if ("children" in node) {
          for (const child of (node as ChildrenMixin).children) collectSnapshot(child);
        }
      }

      for (const node of figma.currentPage.children) collectSnapshot(node);
      result = { capturedAt: Date.now(), componentCount: snapshot.length, components: snapshot };

    } else {
      throw new Error("Unknown RPC method: " + method);
    }

    toUi({ type: "sandbox.rpc-response", rpcId, result });
  } catch (err) {
    toUi({ type: "sandbox.rpc-response", rpcId, error: err instanceof Error ? err.message : String(err) });
  }
}

// ---------------------------------------------------------------------------
// Canvas navigation
// ---------------------------------------------------------------------------
async function zoomTo(nodeId: string) {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    figma.notify("Node " + nodeId + " not found — may have been deleted");
    return;
  }
  if (node.type === "DOCUMENT") return;

  let page: PageNode | null = null;
  let cursor: BaseNode | null = node;
  while (cursor && cursor.type !== "PAGE") {
    cursor = "parent" in cursor ? cursor.parent : null;
  }
  if (cursor && cursor.type === "PAGE") page = cursor as PageNode;

  if (page && figma.currentPage !== page) {
    await figma.setCurrentPageAsync(page);
  }
  if ("visible" in node) {
    figma.currentPage.selection = [node as SceneNode];
    figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
  }
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------
async function dryRun(planId: string, selectedOpIds: string[]) {
  if (!state.currentPlan || state.currentPlan.planId !== planId) return;

  const warnings: Warning[] = [];
  const nameCollisions = new Map<string, number>();

  for (const op of state.currentPlan.operations) {
    if (!selectedOpIds.includes(op.id)) continue;

    if (op.verb === "create-node") {
      warnings.push({ opId: op.id, level: "info", message: "Will create " + op.nodeType + ": " + op.name });
      continue;
    }

    const node = await figma.getNodeByIdAsync(op.target.id);
    if (!node) {
      warnings.push({ opId: op.id, level: "error", message: "Target node no longer exists" });
      continue;
    }

    if (op.verb === "rename") {
      if ("parent" in node && node.parent && "children" in node.parent) {
        const siblings = node.parent.children;
        const collision = siblings.find((s) => s.id !== node.id && s.name === op.to);
        if (collision) {
          const key = node.parent.id + ":" + op.to;
          nameCollisions.set(key, (nameCollisions.get(key) || 0) + 1);
        }
      }
      if ("locked" in node && (node as SceneNode).locked) {
        warnings.push({ opId: op.id, level: "warning", message: "Node is locked — rename may be skipped" });
      }
    }

    if (op.verb === "set-variable") {
      warnings.push({ opId: op.id, level: "info", message: "Variable cascades not yet analyzed in dry run" });
    }
  }

  if (state.currentPlan.preflight) {
    for (const pf of state.currentPlan.preflight) {
      if (pf.kind === "font-load") {
        try {
          await figma.loadFontAsync(pf.value);
        } catch (e) {
          warnings.push({ opId: "preflight", level: "error", message: "Font not available: " + pf.value.family + " " + pf.value.style });
        }
      }
    }
  }

  toUi({ type: "sandbox.dry-run-result", planId, warnings });
  emitEvent({ type: "plan.dry-run.complete", planId, warnings });
}

// ---------------------------------------------------------------------------
// Apply plan
// ---------------------------------------------------------------------------
async function applyPlan(planId: string, selectedOpIds: string[]) {
  if (!state.currentPlan) return;

  emitEvent({ type: "plan.executing", planId, selectedOpIds });

  const reverseOps: Operation[] = [];
  const plan = state.currentPlan;

  if (plan.preflight) {
    for (const pf of plan.preflight) {
      if (pf.kind === "font-load") {
        try {
          await figma.loadFontAsync(pf.value);
        } catch (e) {
          emitEvent({ type: "op.failed", opId: "preflight", error: "Font preload failed: " + (e as Error).message, recoverable: false });
          return;
        }
      }
    }
  }

  for (const op of plan.operations) {
    if (!selectedOpIds.includes(op.id)) continue;
    try {
      const reverse = await executeOp(op);
      if (reverse) reverseOps.push(reverse);
      emitEvent({ type: "op.complete", opId: op.id, result: "ok" });
    } catch (e) {
      emitEvent({ type: "op.failed", opId: op.id, error: (e as Error).message, recoverable: true });
    }
  }

  const snapshotId = "snap_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  const snapshot: Snapshot = { id: snapshotId, planId, createdAt: Date.now(), reverseOps: reverseOps.reverse() };
  state.snapshots.set(snapshotId, snapshot);

  const entry: HistoryEntry = {
    snapshotId,
    planId,
    title: plan.title,
    appliedAt: Date.now(),
    opCount: reverseOps.length,
    reversible: reverseOps.length > 0,
  };
  state.history.push(entry);
  await saveHistory();

  toUi({ type: "sandbox.history", entries: state.history });
  emitEvent({ type: "plan.complete", planId, snapshotId });
  // Remove only the applied operations; keep remaining ones for further apply
  state.currentPlan.operations = state.currentPlan.operations.filter(
    (op: Operation) => !selectedOpIds.includes(op.id)
  );
  if (state.currentPlan.operations.length === 0) {
    state.currentPlan = null;
  }
  figma.notify("Applied " + reverseOps.length + " changes");
}

// ---------------------------------------------------------------------------
// Per-operation execution
// ---------------------------------------------------------------------------
async function executeOp(op: Operation): Promise<Operation | null> {
  if (op.verb === "create-node") {
    const parent = figma.currentPage;

    if (op.nodeType === "STICKY") {
      const sticky = figma.createSticky();
      sticky.x = op.x;
      sticky.y = op.y;
      sticky.name = op.name;
      if (op.text) sticky.text.characters = op.text;
      if (op.fillColor) sticky.fills = [{ type: "SOLID", color: op.fillColor }];
      parent.appendChild(sticky);
    } else if (op.nodeType === "TEXT") {
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      const txt = figma.createText();
      txt.x = op.x;
      txt.y = op.y;
      txt.name = op.name;
      if (op.text) txt.characters = op.text;
      if (op.fillColor) txt.fills = [{ type: "SOLID", color: op.fillColor }];
      parent.appendChild(txt);
    } else if (op.nodeType === "FRAME") {
      const frame = figma.createFrame();
      frame.x = op.x;
      frame.y = op.y;
      frame.resize(op.width, op.height);
      frame.name = op.name;
      if (op.fillColor) frame.fills = [{ type: "SOLID", color: op.fillColor }];
      parent.appendChild(frame);
    } else {
      const rect = figma.createRectangle();
      rect.x = op.x;
      rect.y = op.y;
      rect.resize(op.width, op.height);
      rect.name = op.name;
      if (op.fillColor) rect.fills = [{ type: "SOLID", color: op.fillColor }];
      parent.appendChild(rect);
    }
    return null;
  }

  const node = await figma.getNodeByIdAsync(op.target.id);
  if (!node) {
    throw new Error("Target node " + op.target.id + " not found");
  }

  if (op.verb === "rename") {
    const previous = node.name;
    node.name = op.to;
    return {
      id: op.id + "_reverse",
      verb: "rename",
      target: op.target,
      context: op.context,
      from: op.to,
      to: previous,
      reason: "Undo of " + op.id,
      risk: op.risk,
      reversible: true,
      cascades: [],
    };
  }

  if (op.verb === "set-variable") {
    const variable = await figma.variables.getVariableByIdAsync(op.variableId);
    if (!variable) throw new Error("Variable not found: " + op.variableId);

    const prop = op.property;

    // -- Fill/stroke color binding --
    if (prop === "fills" || prop === "strokes") {
      const geo = node as GeometryMixin;
      const paints: Paint[] = [...(geo[prop] as Paint[])];
      if (paints.length === 0) throw new Error("Node has no " + prop + " to bind");
      const solidIdx = paints.findIndex(p => p.type === "SOLID");
      if (solidIdx === -1) throw new Error("No SOLID paint found in " + prop + " (found: " + paints.map(p => p.type).join(", ") + ")");
      const newPaint = figma.variables.setBoundVariableForPaint(paints[solidIdx] as SolidPaint, "color", variable);
      const newPaints = [...paints];
      newPaints[solidIdx] = newPaint;
      (geo as any)[prop] = newPaints;
      return {
        id: op.id + "_reverse",
        verb: "set-variable",
        target: op.target,
        variableId: "",
        property: prop,
        from: op.to,
        to: op.from,
        reason: "Undo of " + op.id,
        risk: op.risk,
        reversible: false,
        cascades: [],
      } as SetVariableOperation;
    }

    // -- Numeric property binding (opacity, cornerRadius, spacing, padding, size) --
    const numericProps = [
      "opacity", "cornerRadius", "itemSpacing",
      "paddingLeft", "paddingRight", "paddingTop", "paddingBottom",
      "width", "height"
    ];
    if (numericProps.includes(prop)) {
      // Capture previous bound variable (if any) before overwriting
      const prevBoundVars = (node as any).boundVariables;
      const prevVarRef = prevBoundVars && prevBoundVars[prop];
      const prevVarId: string = prevVarRef
        ? (Array.isArray(prevVarRef) ? prevVarRef[0]?.id : prevVarRef?.id) || ""
        : "";
      const previousValue = (node as any)[prop];
      (node as any).setBoundVariable(prop as VariableBindableNodeField, variable);
      // Reverse: rebind to previous variable, or no-op if there was none
      if (prevVarId) {
        return {
          id: op.id + "_reverse",
          verb: "set-variable",
          target: op.target,
          variableId: prevVarId,
          property: prop,
          from: op.to,
          to: op.from,
          reason: "Undo of " + op.id,
          risk: "safe",
          reversible: false,
          cascades: [],
        } as SetVariableOperation;
      }
      // No previous binding — record as non-reversible rename for display only
      return {
        id: op.id + "_reverse",
        verb: "rename",
        target: op.target,
        from: String(previousValue),
        to: String(previousValue),
        reason: "Undo not available: property had no prior variable binding",
        risk: "safe",
        reversible: false,
        cascades: [],
      } as RenameOperation;
    }

    throw new Error("Unsupported property for set-variable: " + prop);
  }

  throw new Error("Unknown verb: " + (op as {verb: string}).verb);
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------
async function undoLast() {
  const last = state.history[state.history.length - 1];
  if (!last) {
    figma.notify("Nothing to undo");
    return;
  }
  const snap = state.snapshots.get(last.snapshotId);
  if (!snap) {
    figma.notify("Snapshot not available in this session — Figma's native undo (Cmd+Z) may still work");
    return;
  }

  let reverted = 0;
  for (const op of snap.reverseOps) {
    try {
      await executeOp(op);
      reverted++;
    } catch (e) {
      // Keep going
    }
  }

  state.history.pop();
  state.snapshots.delete(last.snapshotId);
  await saveHistory();
  toUi({ type: "sandbox.history", entries: state.history });
  figma.notify("Reverted " + reverted + " changes");
}

// Removed floating loadHistory() call to prevent concurrent figma.clientStorage access.
// History is already reliably loaded when the UI sends "ui.ready".
