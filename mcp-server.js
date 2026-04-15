const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const http = require("http");
const fs = require("fs");
const path = require("path");

const server = new Server({
  name: "figma-control-bridge-mcp",
  version: "2.0.0"
}, {
  capabilities: { tools: {} }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function callRpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 7879,
      path: '/rpc',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(body).result); }
          catch(e) { reject(new Error("Invalid response from bridge")); }
        } else {
          try { reject(new Error(JSON.parse(body).error || "RPC Failed")); }
          catch(e) { reject(new Error(`RPC Failed with status ${res.statusCode}`)); }
        }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify({ method, params }));
    req.end();
  });
}

/** Post a Plan to the bridge and wait for plan.complete or plan.rejected via SSE. */
function postPlanAndWait(plan) {
  return new Promise((resolve) => {
    let resolved = false;

    const sseReq = http.get('http://localhost:7879/events', (sseRes) => {
      let buffer = '';
      sseRes.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.substring(6));
              if (event.planId === plan.planId) {
                if (event.type === "plan.complete") {
                  if (!resolved) {
                    resolved = true; sseReq.destroy();
                    resolve({ content: [{ type: "text", text: `Plan "${plan.title}" applied. ${plan.operations.length} operation(s) executed.` }] });
                  }
                } else if (event.type === "plan.rejected") {
                  if (!resolved) {
                    resolved = true; sseReq.destroy();
                    resolve({ isError: true, content: [{ type: "text", text: "User rejected the plan in Figma." }] });
                  }
                }
              }
            } catch(e) {}
          }
        }
      });
    });
    sseReq.on('error', () => {
      if (!resolved) { resolved = true; resolve({ isError: true, content: [{ type: "text", text: "SSE connection failed" }] }); }
    });

    const req = http.request({
      hostname: 'localhost', port: 7879, path: '/plan', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      if (res.statusCode !== 202) {
        if (!resolved) { resolved = true; sseReq.destroy(); resolve({ isError: true, content: [{ type: "text", text: "Failed to submit plan to bridge" }] }); }
      }
    });
    req.on('error', (e) => {
      if (!resolved) { resolved = true; sseReq.destroy(); resolve({ isError: true, content: [{ type: "text", text: "Bridge server not reachable on port 7879" }] }); }
    });
    req.write(JSON.stringify(plan));
    req.end();
  });
}

function makePlanId() {
  return "mcp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [

    // ── Original tools ──────────────────────────────────────────────────────

    {
      name: "figma_get_selection",
      description: "Returns an array of Figma nodes currently selected in the desktop app. Always use this to discover node IDs instead of guessing.",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "figma_inspect_node",
      description: "Fetch details (children, type, name) of a specific Figma node.",
      inputSchema: {
        type: "object",
        properties: {
          nodeId: { type: "string", description: "Figma node ID, e.g. '12:34'" }
        },
        required: ["nodeId"]
      }
    },
    {
      name: "figma_propose_rename",
      description: "Propose renaming a single node. Blocks until user clicks Apply or Reject in the Figma plugin panel.",
      inputSchema: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          nodeType: { type: "string", description: "e.g. COMPONENT, FRAME, RECTANGLE" },
          currentName: { type: "string" },
          newName: { type: "string" },
          reason: { type: "string" }
        },
        required: ["nodeId", "nodeType", "currentName", "newName", "reason"]
      }
    },

    // ── P0: Batch operations ─────────────────────────────────────────────────

    {
      name: "figma_propose_batch_operations",
      description: `Submit multiple rename/create-node operations as a single Plan. The user reviews and approves/rejects the whole batch in the Figma plugin panel at once — far more efficient than calling figma_propose_rename repeatedly.

Use this when you need to:
- Rename many components to follow naming conventions
- Create multiple nodes at once
- Apply a design system refactor across many layers

Blocks until the user clicks Apply or Reject in Figma.`,
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Plan title shown in the Figma panel header" },
          summary: { type: "string", description: "One-line description of what this batch does" },
          operations: {
            type: "array",
            description: "List of operations to include in this plan",
            items: {
              type: "object",
              properties: {
                verb: { type: "string", enum: ["rename", "create-node"], description: "Operation type" },
                nodeId: { type: "string", description: "Target node ID (required for rename)" },
                nodeType: { type: "string", description: "Node type string, e.g. COMPONENT" },
                currentName: { type: "string", description: "Current name (rename only, for safety check)" },
                newName: { type: "string", description: "New name (rename only)" },
                createNodeType: { type: "string", enum: ["FRAME", "RECTANGLE", "TEXT", "STICKY"], description: "Node type to create (create-node only)" },
                name: { type: "string", description: "Name for new node (create-node only)" },
                x: { type: "number" }, y: { type: "number" },
                width: { type: "number" }, height: { type: "number" },
                text: { type: "string", description: "Text content (TEXT/STICKY only)" },
                fillColor: {
                  type: "object",
                  description: "RGB fill color 0-1 range",
                  properties: { r: { type: "number" }, g: { type: "number" }, b: { type: "number" } }
                },
                reason: { type: "string", description: "Why this operation is needed" },
                risk: { type: "string", enum: ["safe", "risky", "destructive"], default: "safe" }
              },
              required: ["verb", "reason"]
            }
          }
        },
        required: ["title", "summary", "operations"]
      }
    },

    // ── P1: Token audit ──────────────────────────────────────────────────────

    {
      name: "figma_audit_tokens",
      description: `Scan the current Figma page for nodes that use hardcoded fill/stroke colors instead of bound variable tokens.

Returns two lists:
- violations: nodes with hardcoded hex colors (should be using tokens)
- tokenBound: nodes correctly bound to variables

Use this to audit design system compliance. Run before proposing a batch set-variable fix.`,
      inputSchema: {
        type: "object",
        properties: {
          maxNodes: {
            type: "number",
            description: "Max nodes to scan (default 500, increase for large files)",
            default: 500
          },
          checkTypes: {
            type: "array",
            items: { type: "string", enum: ["fills", "strokes"] },
            description: "Which properties to audit (default: both)",
            default: ["fills", "strokes"]
          }
        }
      }
    },

    // ── P2: Component list ───────────────────────────────────────────────────

    {
      name: "figma_list_components",
      description: `List all COMPONENT and COMPONENT_SET nodes on the current Figma page.

Returns each component's id, name, type, description, and variant properties (for COMPONENT_SET).

Use this to:
- Get an overview of the component library
- Find component IDs before calling figma_inspect_node
- Cross-reference with get_code_connect_map to identify unmapped components`,
      inputSchema: {
        type: "object",
        properties: {
          includeVariants: {
            type: "boolean",
            description: "If true, also list individual COMPONENT children of COMPONENT_SETs (default false)",
            default: false
          }
        }
      }
    },

    // ── P3: Token export ─────────────────────────────────────────────────────

    {
      name: "figma_export_tokens",
      description: `Export all Figma local variables (design tokens) to a file in the specified format.

Supported formats:
- css-variables: :root { --color-brand-primary: #FF5733; }
- style-dictionary: { "color": { "brand": { "primary": { "value": "#FF5733" } } } }
- tailwind: module.exports = { theme: { extend: { colors: { ... } } } }
- json: flat { "color/brand/primary": "#FF5733" }

Use this to sync Figma tokens to your codebase token files.`,
      inputSchema: {
        type: "object",
        properties: {
          format: {
            type: "string",
            enum: ["css-variables", "style-dictionary", "tailwind", "json"],
            description: "Output format"
          },
          outputPath: {
            type: "string",
            description: "Absolute path to write the file to, e.g. /Users/me/project/tokens/colors.css"
          },
          collections: {
            type: "array",
            items: { type: "string" },
            description: "Variable collection names to include. Omit to export all collections."
          }
        },
        required: ["format", "outputPath"]
      }
    },

    // ── P4: Set variable ─────────────────────────────────────────────────────

    {
      name: "figma_propose_set_variable",
      description: `Propose binding a Figma variable (design token) to a node property. Sends a Plan to the Figma plugin for user approval before executing.

Use this to fix token violations found by figma_audit_tokens — replace hardcoded colors with proper variable bindings.

Supported properties: fills (fill color), strokes (stroke color), opacity, cornerRadius, itemSpacing, paddingLeft, paddingRight, paddingTop, paddingBottom, width, height

Blocks until the user clicks Apply or Reject in Figma.`,
      inputSchema: {
        type: "object",
        properties: {
          nodeId: { type: "string", description: "Target node ID" },
          nodeType: { type: "string", description: "Node type, e.g. FRAME" },
          property: {
            type: "string",
            description: "Property to bind the variable to",
            enum: ["fills", "strokes", "opacity", "cornerRadius", "itemSpacing",
                   "paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "width", "height"]
          },
          variableId: { type: "string", description: "Figma variable ID to bind" },
          variableName: { type: "string", description: "Human-readable variable name for display" },
          currentValue: { type: "string", description: "Current hardcoded value (for the approval UI)" },
          reason: { type: "string" }
        },
        required: ["nodeId", "nodeType", "property", "variableId", "variableName", "reason"]
      }
    },

    // ── #1: Instance override audit ─────────────────────────────────────────

    {
      name: "figma_audit_overrides",
      description: `Scan the current Figma page for INSTANCE nodes whose style properties diverge from their master component.

Violations are classified into three severity levels:
- structural: mainComponent is null — instance is detached or references a missing library component. These are the most critical.
- style: fills, strokes, effects, or blendMode differ from master — likely unintentional design drift.
- cosmetic: only opacity/cornerRadius differ — lower risk but still worth reviewing.

Content overrides (text, images) are intentional and NOT reported.

Use this to identify design system drift before a design review or release.`,
      inputSchema: {
        type: "object",
        properties: {
          maxNodes: { type: "number", description: "Max instances to scan (default 300)", default: 300 }
        }
      }
    },

    // ── #5: Component snapshot & diff ────────────────────────────────────────

    {
      name: "figma_component_snapshot",
      description: `Save a snapshot of all components on the current Figma page to a JSON file.

The snapshot captures: component name, description, variant properties (and their allowed values), key style attributes (fills, cornerRadius, spacing, size), and timestamp.

Use this before a design system release, then call figma_diff_snapshots after the next Figma update to detect breaking changes automatically.`,
      inputSchema: {
        type: "object",
        properties: {
          outputPath: { type: "string", description: "Absolute path to write the snapshot JSON, e.g. /Users/me/project/.ds-snapshot.json" }
        },
        required: ["outputPath"]
      }
    },
    {
      name: "figma_diff_snapshots",
      description: `Compare two component snapshots (created by figma_component_snapshot) and report what changed.

Detects:
- added: new components that didn't exist before
- removed: components that were deleted or renamed (breaking change)
- variantsChanged: variant property keys or values changed (breaking change for consumers)
- stylesChanged: visual style properties (fills, cornerRadius, spacing) changed
- descriptionChanged: documentation updated

Use this in a design review workflow: snapshot before → designer makes changes → snapshot after → diff to see what broke.`,
      inputSchema: {
        type: "object",
        properties: {
          beforePath: { type: "string", description: "Path to the older snapshot JSON file" },
          afterPath:  { type: "string", description: "Path to the newer snapshot JSON file" }
        },
        required: ["beforePath", "afterPath"]
      }
    },

    // ── #11: Semantic token suggestion ───────────────────────────────────────

    {
      name: "figma_suggest_tokens",
      description: `For a given Figma node, inspect its current style values and suggest which design tokens (variables) best match each property.

For each style property (fill color, stroke color, cornerRadius, spacing, etc.):
- If already bound to a token: shows the current binding ✅
- If hardcoded: finds the closest matching token by value and suggests it ⚠️
- If no match found: flags it as needing a new token ❌

Use this during design handoff to translate pixel values into semantic token names, or to fix nodes found by figma_audit_tokens.`,
      inputSchema: {
        type: "object",
        properties: {
          nodeId: { type: "string", description: "Figma node ID to inspect" }
        },
        required: ["nodeId"]
      }
    },

    // ── P5: Structured component search ─────────────────────────────────────

    {
      name: "figma_search_components",
      description: `Search components on the current Figma page with structural filters beyond simple text matching.

Filters available:
- query: text search on component name
- variantFilter: filter by variant property values, e.g. { "Size": "Large", "State": "Hover" }
- nodeTypes: restrict to COMPONENT, COMPONENT_SET, or both
- hasDescription: only components with/without a description

Returns matching components with their id, name, variant properties, and description.`,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to search in component names (case-insensitive, partial match)" },
          variantFilter: {
            type: "object",
            description: "Variant property key/value pairs to match, e.g. { \"Size\": \"Large\" }",
            additionalProperties: { type: "string" }
          },
          nodeTypes: {
            type: "array",
            items: { type: "string", enum: ["COMPONENT", "COMPONENT_SET"] },
            description: "Node types to include (default: both)",
            default: ["COMPONENT", "COMPONENT_SET"]
          },
          hasDescription: {
            type: "boolean",
            description: "If true, only return components with a description. If false, only without."
          }
        }
      }
    }
  ]
}));

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // ── figma_get_selection ───────────────────────────────────────────────────
  if (name === "figma_get_selection") {
    try {
      const selection = await callRpc("get_selection");
      return { content: [{ type: "text", text: JSON.stringify(selection, null, 2) }] };
    } catch(e) {
      return { isError: true, content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }

  // ── figma_inspect_node ────────────────────────────────────────────────────
  if (name === "figma_inspect_node") {
    try {
      const nodeInfo = await callRpc("inspect_node", { nodeId: args.nodeId });
      return { content: [{ type: "text", text: JSON.stringify(nodeInfo, null, 2) }] };
    } catch(e) {
      return { isError: true, content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }

  // ── figma_propose_rename (original, single) ────────────────────────────────
  if (name === "figma_propose_rename") {
    const { nodeId, nodeType, currentName, newName, reason } = args;
    const plan = {
      planId: makePlanId(),
      title: "Rename: " + currentName,
      summary: reason,
      domain: "figma",
      operations: [{
        id: "op_" + Date.now(),
        verb: "rename",
        target: { kind: "node", id: nodeId, type: nodeType },
        from: currentName, to: newName, reason,
        risk: "safe", reversible: true, cascades: []
      }]
    };
    return postPlanAndWait(plan);
  }

  // ── P0: figma_propose_batch_operations ────────────────────────────────────
  if (name === "figma_propose_batch_operations") {
    const { title, summary, operations } = args;
    const ops = operations.map((op, i) => {
      if (op.verb === "rename") {
        return {
          id: `op_${Date.now()}_${i}`,
          verb: "rename",
          target: { kind: "node", id: op.nodeId, type: op.nodeType || "UNKNOWN" },
          from: op.currentName || "",
          to: op.newName || "",
          reason: op.reason,
          risk: op.risk || "safe",
          reversible: true,
          cascades: []
        };
      } else if (op.verb === "create-node") {
        return {
          id: `op_${Date.now()}_${i}`,
          verb: "create-node",
          target: { kind: "node", id: "" },
          nodeType: op.createNodeType || "RECTANGLE",
          name: op.name || "New Node",
          x: op.x || 0, y: op.y || 0,
          width: op.width || 100, height: op.height || 100,
          text: op.text,
          fillColor: op.fillColor,
          reason: op.reason,
          risk: op.risk || "safe",
          reversible: false,
          cascades: []
        };
      }
      throw new Error(`Unknown verb: ${op.verb}`);
    });

    const plan = {
      planId: makePlanId(),
      title,
      summary,
      domain: "figma",
      operations: ops
    };
    return postPlanAndWait(plan);
  }

  // ── P1: figma_audit_tokens ────────────────────────────────────────────────
  if (name === "figma_audit_tokens") {
    try {
      const result = await callRpc("audit_tokens", {
        maxNodes: args.maxNodes || 500,
        checkTypes: args.checkTypes || ["fills", "strokes"]
      });
      const { violations, tokenBound, scanned } = result;
      const lines = [
        `Scanned ${scanned} nodes.`,
        ``,
        `Token violations (hardcoded values): ${violations.length}`,
        ...violations.map(v =>
          `  [${v.nodeId}] "${v.nodeName}" (${v.nodeType}) — ${v.property}: ${v.hardcodedValue}`
        ),
        ``,
        `Token-bound nodes (compliant): ${tokenBound.length}`,
        ...tokenBound.map(v =>
          `  [${v.nodeId}] "${v.nodeName}" — ${v.property}: ${v.variableName}`
        )
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch(e) {
      return { isError: true, content: [{ type: "text", text: `Audit failed: ${e.message}` }] };
    }
  }

  // ── P2: figma_list_components ─────────────────────────────────────────────
  if (name === "figma_list_components") {
    try {
      const result = await callRpc("list_components", {
        includeVariants: args.includeVariants || false
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch(e) {
      return { isError: true, content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }

  // ── P3: figma_export_tokens ───────────────────────────────────────────────
  if (name === "figma_export_tokens") {
    try {
      const rawTokens = await callRpc("get_all_variables", {
        collections: args.collections || null
      });

      const { format, outputPath } = args;
      let output = "";

      if (format === "json") {
        const flat = {};
        for (const token of rawTokens) {
          flat[token.path] = token.resolvedValue;
        }
        output = JSON.stringify(flat, null, 2);

      } else if (format === "css-variables") {
        const lines = [":root {"];
        for (const token of rawTokens) {
          const varName = "--" + token.path.replace(/\//g, "-").replace(/[^a-zA-Z0-9-]/g, "-");
          lines.push(`  ${varName}: ${token.resolvedValue};`);
        }
        lines.push("}");
        output = lines.join("\n");

      } else if (format === "style-dictionary") {
        const nested = {};
        for (const token of rawTokens) {
          const parts = token.path.split("/");
          let cur = nested;
          for (let i = 0; i < parts.length - 1; i++) {
            if (!cur[parts[i]]) cur[parts[i]] = {};
            cur = cur[parts[i]];
          }
          cur[parts[parts.length - 1]] = { value: token.resolvedValue, type: token.type };
        }
        output = JSON.stringify(nested, null, 2);

      } else if (format === "tailwind") {
        const colors = {}, spacing = {}, other = {};
        for (const token of rawTokens) {
          const key = token.path.replace(/\//g, "-");
          if (token.type === "COLOR") colors[key] = token.resolvedValue;
          else if (token.type === "FLOAT" && /spacing|gap|padding|margin/i.test(token.path)) spacing[key] = token.resolvedValue + "px";
          else other[key] = token.resolvedValue;
        }
        const tw = { theme: { extend: {} } };
        if (Object.keys(colors).length) tw.theme.extend.colors = colors;
        if (Object.keys(spacing).length) tw.theme.extend.spacing = spacing;
        output = "module.exports = " + JSON.stringify(tw, null, 2) + ";";
      }

      // Security: restrict writes to user's home directory subtree
      const resolved = path.resolve(outputPath);
      const homeDir = require("os").homedir();
      if (!resolved.startsWith(homeDir + path.sep)) {
        return { isError: true, content: [{ type: "text", text: "Export path must be inside your home directory." }] };
      }
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(resolved, output, "utf-8");

      return { content: [{ type: "text", text: `Exported ${rawTokens.length} tokens to ${outputPath} (${format} format).` }] };
    } catch(e) {
      return { isError: true, content: [{ type: "text", text: `Export failed: ${e.message}` }] };
    }
  }

  // ── P4: figma_propose_set_variable ────────────────────────────────────────
  if (name === "figma_propose_set_variable") {
    const { nodeId, nodeType, property, variableId, variableName, currentValue, reason } = args;
    const plan = {
      planId: makePlanId(),
      title: `Bind token: ${variableName} → ${property}`,
      summary: reason,
      domain: "figma",
      operations: [{
        id: "op_" + Date.now(),
        verb: "set-variable",
        target: { kind: "node", id: nodeId, type: nodeType },
        property,
        variableId,
        from: currentValue || "(hardcoded)",
        to: variableName,
        reason,
        risk: "safe",
        reversible: true,
        cascades: [{ kind: "bound-variable", detail: `Binds ${property} to ${variableName}` }]
      }]
    };
    return postPlanAndWait(plan);
  }

  // ── #1: figma_audit_overrides ─────────────────────────────────────────────
  if (name === "figma_audit_overrides") {
    try {
      const result = await callRpc("audit_overrides", { maxNodes: args.maxNodes || 300 });
      const { structural, styleViolations, instancesScanned } = result;
      const lines = [
        `Scanned ${instancesScanned} instances on current page.`,
        "",
        `❌ Structural (detached/missing): ${structural.length}`,
        ...structural.map(v => `  [${v.nodeId}] "${v.nodeName}" — ${v.reason}`),
        "",
        `⚠️  Style overrides (drift from master): ${styleViolations.length}`,
        ...styleViolations.map(v =>
          `  [${v.nodeId}] "${v.nodeName}" ← master: "${v.masterName}"\n` +
          `    overridden: ${v.overriddenProps.join(", ")}  [${v.severity}]`
        ),
        "",
        `Total violations: ${structural.length + styleViolations.length}`
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch(e) {
      return { isError: true, content: [{ type: "text", text: `Override audit failed: ${e.message}` }] };
    }
  }

  // ── #5: figma_component_snapshot ──────────────────────────────────────────
  if (name === "figma_component_snapshot") {
    try {
      const snapshot = await callRpc("get_component_snapshot", {});
      const { outputPath } = args;
      const resolved = path.resolve(outputPath);
      const homeDir = require("os").homedir();
      if (!resolved.startsWith(homeDir + path.sep)) {
        return { isError: true, content: [{ type: "text", text: "Snapshot path must be inside your home directory." }] };
      }
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(resolved, JSON.stringify(snapshot, null, 2), "utf-8");
      return { content: [{ type: "text", text: `Snapshot saved: ${snapshot.componentCount} components → ${outputPath}\nTimestamp: ${new Date(snapshot.capturedAt).toISOString()}` }] };
    } catch(e) {
      return { isError: true, content: [{ type: "text", text: `Snapshot failed: ${e.message}` }] };
    }
  }

  // ── #5: figma_diff_snapshots ───────────────────────────────────────────────
  if (name === "figma_diff_snapshots") {
    try {
      const { beforePath, afterPath } = args;
      const before = JSON.parse(fs.readFileSync(beforePath, "utf-8"));
      const after  = JSON.parse(fs.readFileSync(afterPath, "utf-8"));

      const beforeMap = Object.fromEntries(before.components.map(c => [c.id, c]));
      const afterMap  = Object.fromEntries(after.components.map(c => [c.id, c]));

      const added    = after.components.filter(c => !beforeMap[c.id]);
      const removed  = before.components.filter(c => !afterMap[c.id]);
      const changed  = [];

      for (const ac of after.components) {
        const bc = beforeMap[ac.id];
        if (!bc) continue;
        const diffs = [];

        // Variant property changes (breaking for consumers)
        const bvp = JSON.stringify(bc.variantProperties || {});
        const avp = JSON.stringify(ac.variantProperties || {});
        if (bvp !== avp) diffs.push({ field: "variantProperties", before: bc.variantProperties, after: ac.variantProperties });

        // Name change (breaking)
        if (bc.name !== ac.name) diffs.push({ field: "name", before: bc.name, after: ac.name });

        // Description change
        if (bc.description !== ac.description) diffs.push({ field: "description", before: bc.description, after: ac.description });

        // Style changes
        const bs = JSON.stringify(bc.styles || {});
        const as_ = JSON.stringify(ac.styles || {});
        if (bs !== as_) diffs.push({ field: "styles", before: bc.styles, after: ac.styles });

        if (diffs.length > 0) changed.push({ id: ac.id, name: ac.name, diffs });
      }

      const breaking = changed.filter(c => c.diffs.some(d => ["variantProperties", "name"].includes(d.field)));
      const nonBreaking = changed.filter(c => !c.diffs.some(d => ["variantProperties", "name"].includes(d.field)));

      const lines = [
        `Diff: ${path.basename(beforePath)} → ${path.basename(afterPath)}`,
        `Before: ${before.componentCount} components  After: ${after.componentCount} components`,
        "",
        `🆕 Added (${added.length}):`,
        ...added.map(c => `  + ${c.type} "${c.name}"`),
        "",
        `🗑  Removed (${removed.length}) — BREAKING:`,
        ...removed.map(c => `  - ${c.type} "${c.name}" [${c.id}]`),
        "",
        `💥 Breaking changes (${breaking.length}):`,
        ...breaking.flatMap(c => [
          `  "${c.name}"`,
          ...c.diffs.filter(d => ["variantProperties","name"].includes(d.field))
            .map(d => `    ${d.field}: ${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}`)
        ]),
        "",
        `🎨 Style/doc changes (${nonBreaking.length}):`,
        ...nonBreaking.flatMap(c => [
          `  "${c.name}"`,
          ...c.diffs.map(d => `    ${d.field} changed`)
        ])
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch(e) {
      return { isError: true, content: [{ type: "text", text: `Diff failed: ${e.message}` }] };
    }
  }

  // ── #11: figma_suggest_tokens ─────────────────────────────────────────────
  if (name === "figma_suggest_tokens") {
    try {
      const [nodeInfo, allTokens] = await Promise.all([
        callRpc("inspect_node", { nodeId: args.nodeId }),
        callRpc("get_all_variables", {})
      ]);

      const style = nodeInfo.style || {};
      const suggestions = [];

      // Build lookup maps by type and value
      const colorTokens  = allTokens.filter(t => t.type === "COLOR");
      const floatTokens  = allTokens.filter(t => t.type === "FLOAT");
      const boundVars    = style.boundVariables || {};

      function hexDistance(a, b) {
        // Simple RGB Euclidean distance on 0-255 scale
        const parse = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
        if (!a.startsWith('#') || !b.startsWith('#')) return 999;
        const [ar,ag,ab] = parse(a), [br,bg,bb] = parse(b);
        return Math.sqrt((ar-br)**2 + (ag-bg)**2 + (ab-bb)**2);
      }

      function findColorToken(hex) {
        let best = null, bestDist = 999;
        for (const t of colorTokens) {
          const d = hexDistance(hex, t.resolvedValue);
          if (d < bestDist) { bestDist = d; best = t; }
        }
        return { token: best, exact: bestDist === 0, distance: Math.round(bestDist) };
      }

      function findFloatToken(val) {
        const exact = floatTokens.find(t => parseFloat(t.resolvedValue) === val);
        if (exact) return { token: exact, exact: true };
        // Find closest
        let best = null, bestDiff = Infinity;
        for (const t of floatTokens) {
          const diff = Math.abs(parseFloat(t.resolvedValue) - val);
          if (diff < bestDiff) { bestDiff = diff; best = t; }
        }
        return { token: best, exact: false, diff: bestDiff };
      }

      // Fills
      if (style.fills) {
        style.fills.forEach((fill, i) => {
          if (fill.type !== "SOLID") return;
          const propKey = "fills";
          if (boundVars[propKey]) {
            suggestions.push({ property: `fills[${i}]`, status: "bound", value: fill.color, tokenId: boundVars[propKey], note: "✅ Already token-bound" });
          } else {
            const { token, exact, distance } = findColorToken(fill.color);
            suggestions.push({
              property: `fills[${i}]`, status: exact ? "exact_match" : "nearest",
              value: fill.color,
              suggestedToken: token ? token.path : null,
              suggestedValue: token ? token.resolvedValue : null,
              tokenId: token ? token.id : null,
              note: exact ? `⚠️  Hardcoded. Exact match: ${token?.path}` : `⚠️  Hardcoded. Nearest (distance=${distance}): ${token?.path}`
            });
          }
        });
      }

      // Strokes
      if (style.strokes) {
        style.strokes.forEach((stroke, i) => {
          if (stroke.type !== "SOLID") return;
          if (boundVars["strokes"]) {
            suggestions.push({ property: `strokes[${i}]`, status: "bound", value: stroke.color, note: "✅ Already token-bound" });
          } else {
            const { token, exact, distance } = findColorToken(stroke.color);
            suggestions.push({
              property: `strokes[${i}]`, status: exact ? "exact_match" : "nearest",
              value: stroke.color,
              suggestedToken: token ? token.path : null,
              tokenId: token ? token.id : null,
              note: exact ? `⚠️  Exact match: ${token?.path}` : `⚠️  Nearest (distance=${distance}): ${token?.path}`
            });
          }
        });
      }

      // Numeric props
      const numericChecks = [
        ["cornerRadius", style.cornerRadius],
        ["opacity",      style.opacity !== undefined ? style.opacity * 100 : undefined],
        ["itemSpacing",  style.itemSpacing],
        ...(style.padding ? [["paddingLeft", style.padding.left], ["paddingTop", style.padding.top]] : [])
      ];
      for (const [prop, val] of numericChecks) {
        if (val === undefined || val === null) continue;
        if (boundVars[prop]) {
          suggestions.push({ property: prop, status: "bound", value: val, note: "✅ Already token-bound" });
        } else {
          const { token, exact, diff } = findFloatToken(Number(val));
          if (token) suggestions.push({
            property: prop, status: exact ? "exact_match" : "nearest",
            value: val,
            suggestedToken: token.path,
            tokenId: token.id,
            note: exact ? `⚠️  Exact match: ${token.path}` : `⚠️  Nearest (diff=${diff?.toFixed(1)}): ${token.path}`
          });
        }
      }

      const lines = [
        `Token suggestions for node "${nodeInfo.name}" [${nodeInfo.id}] (${nodeInfo.type}):`,
        "",
        ...suggestions.map(s => `  ${s.property}: ${s.value}  →  ${s.note}${s.tokenId ? `\n    tokenId: ${s.tokenId}` : ""}`),
        "",
        `Summary: ${suggestions.filter(s=>s.status==="bound").length} bound ✅  |  ${suggestions.filter(s=>s.status==="exact_match").length} exact match ⚠️  |  ${suggestions.filter(s=>s.status==="nearest").length} nearest only`
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch(e) {
      return { isError: true, content: [{ type: "text", text: `suggest_tokens failed: ${e.message}` }] };
    }
  }

  // ── P5: figma_search_components ───────────────────────────────────────────
  if (name === "figma_search_components") {
    try {
      const result = await callRpc("search_components", {
        query: args.query || "",
        variantFilter: args.variantFilter || {},
        nodeTypes: args.nodeTypes || ["COMPONENT", "COMPONENT_SET"],
        hasDescription: args.hasDescription
      });
      const total = result.length;
      const text = total === 0
        ? "No components matched the search criteria."
        : `Found ${total} component(s):\n\n` + JSON.stringify(result, null, 2);
      return { content: [{ type: "text", text }] };
    } catch(e) {
      return { isError: true, content: [{ type: "text", text: `Search failed: ${e.message}` }] };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch(console.error);
