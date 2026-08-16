# Architecture Block Studio

Architecture Block Studio is a reusable, read-only architecture workbench for hierarchical software and protocol diagrams. It presents modules as blocks, public interfaces as boundary ports, and concrete protocol DTOs as selectable connections. Hierarchies expand in place: the parent diagram remains visible while child modules and cross-boundary connections are exposed inside the expanded block.

The first bundled design is the AIO Agent Runtime architecture. The studio itself has no AIO runtime dependency and can load any document that satisfies the public `BlockDesignDocument` schema.

## Module Contract

| Module | Principle | Public contract | Boundary and failure behavior |
| --- | --- | --- | --- |
| `model` | Own the document shape and semantic design rules | `parseBlockDesignDocument`, `validateBlockDesignDocument` | Does not render or lay out. Invalid structure is rejected; semantic issues remain explicit DRC messages. |
| `layout` | Compose expanded hierarchy, place compound blocks, and produce render nodes | `layoutBlockDesign` | Does not interpret business meaning or mutate the source document. Placement failure is surfaced to the studio. |
| `routing` | Derive one obstacle-avoiding orthogonal route from visible nodes and ports | `absoluteRoutingObstacles`, `routeOrthogonalInterface` | Does not reposition blocks or rewrite connections. Endpoints are excluded from obstacles; every unrelated visible block remains an obstacle. |
| `studio` | Own selection, expanded levels, dock layout and viewport state | `BlockDesignStudio` | Does not redefine module or interface facts. Load and validation failures are shown without partially installing a document. |
| content provider | Supply one `BlockDesignDocument` | JSON URL, local JSON file, or JavaScript object | Does not import studio internals. References to missing levels, nodes, ports or interfaces fail validation. |

```text
BlockDesignDocument
        |
        v
  model parse + DRC ----------------------> Messages panel
        |
        v
  expanded hierarchy projection
        |
        v
  compound placement
        |
        v
  obstacle-aware orthogonal routing
        |
        v
  React Flow canvas <----> docked sources / inspector / messages
```

The document is the only design-content source. React nodes, edges, hierarchy entries, inspector JSON and DRC messages are all derived from it. Dock width, collapsed panels, expanded hierarchy, selection, zoom and generated route geometry are workspace state; they are never written back as protocol or architecture facts.

### Geometry invariants

- A route starts and ends only at the named endpoint ports.
- A route never enters the bounding box of a non-endpoint block or an unrelated hierarchy container.
- A cross-hierarchy route passes through the parent port declared by `hierarchy.portBindings`; names and interface ids are never used to guess containment.
- Regenerate Layout may change block placement and routing. Optimize Routing preserves block placement and changes only derived routes.
- Connection labels are derived from the routed path. Documents cannot carry manual label offsets.

## Screenshots

| System overview | Clickable Core interface |
| --- | --- |
| ![System overview](docs/screenshots/aio-system-overview.png) | ![Core interface inspector](docs/screenshots/aio-core-interface.png) |

| Raw interface JSON | Tool System hierarchy |
| --- | --- |
| ![Raw interface JSON](docs/screenshots/aio-core-interface-json.png) | ![Tool System](docs/screenshots/aio-tool-system.png) |

## Document Shape

```jsonc
{
  "schemaVersion": "2.0",
  "id": "example.system",
  "title": "Example System",
  "summary": "A minimal two-block design.",
  "entryLevelId": "system",
  "interfaceDefinitions": {
    "session.command": {
      "kind": "rpc",
      "title": "Session Command RPC",
      "owner": "Core",
      "purpose": "Submit a user command.",
      "boundary": "The UI cannot mutate Core state directly.",
      "failure": "Invalid commands are rejected atomically.",
      "sourceRef": { "label": "Protocol", "href": "./protocol.md" },
      "code": "{ \"method\": \"turn/start\", \"params\": {} }"
    }
  },
  "levels": [
    {
      "id": "system",
      "title": "System",
      "nodes": [
        {
          "id": "ui",
          "title": "UI",
          "inspector": {
            "purpose": "Submit commands.",
            "boundary": "Owns display state only.",
            "failure": "Rejected commands remain visible to the user."
          },
          "ports": [
            { "id": "command", "label": "command", "side": "right", "direction": "output" }
          ]
        },
        {
          "id": "core",
          "title": "Core",
          "hierarchy": {
            "childLevelId": "core-internals",
            "portBindings": [
              {
                "parentPortId": "command",
                "childEndpoint": { "nodeId": "session-api", "portId": "external-command" }
              }
            ]
          },
          "inspector": {
            "purpose": "Own and execute the session.",
            "boundary": "Receives commands only through named ports.",
            "failure": "Invalid commands do not mutate persisted state."
          },
          "ports": [
            { "id": "command", "label": "command", "side": "left", "direction": "input" }
          ]
        }
      ],
      "connections": [
        {
          "id": "ui-to-core",
          "interfaceId": "session.command",
          "source": { "nodeId": "ui", "portId": "command" },
          "target": { "nodeId": "core", "portId": "command" }
        }
      ]
    },
    {
      "id": "core-internals",
      "parentLevelId": "system",
      "title": "Core internals",
      "nodes": [
        {
          "id": "session-api",
          "title": "Session API",
          "ports": [
            { "id": "external-command", "label": "command", "side": "left", "direction": "input" }
          ],
          "inspector": {
            "purpose": "Receive the public command.",
            "boundary": "Does not expose mutable Core state.",
            "failure": "Invalid commands are rejected before dispatch."
          }
        }
      ],
      "connections": []
    }
  ]
}
```

Hierarchical nodes use `hierarchy.childLevelId` and must bind every parent port to one explicit child endpoint through `hierarchy.portBindings`. The parent port owns the cross-boundary direction; the child endpoint may be either an implementation port or an explicit boundary-adapter port. Position is optional: ELK computes a layered placement from ports and connections. In the collapsed authored view, `node.layout.position` provides deliberate initial placement; expanding a hierarchy or choosing Regenerate Layout recomputes compound placement with ELK.

The executable schema is [`src/model/design.ts`](src/model/design.ts). Structural parsing is strict about required protocol objects and supplies documented defaults for optional visual fields. Semantic DRC rules live separately in [`src/model/validation.ts`](src/model/validation.ts).

## Loading Designs

- Start with the bundled AIO example.
- Open a local `.json` document from the toolbar.
- Load an HTTP(S) JSON document from the toolbar.
- Add `?design=<encoded-url>` to deep-link a remote or same-origin document.
- Embed `BlockDesignStudio` and provide an already parsed JavaScript object.

Loading is transactional: the current design remains installed until the new document passes structural parsing. Semantic DRC errors are displayed and cross-probe to the affected block or connection.

## Development

```bash
pnpm install
pnpm exec playwright install chromium
pnpm dev --host 127.0.0.1 --port 4317
pnpm typecheck
pnpm build
pnpm test
```

Open `http://127.0.0.1:4317`. The project is self-contained under this directory and can be extracted into its own repository; the AIO JSON document is example content, not a runtime dependency.

## Design References

- [AMD Vivado IP Integrator: Designing with IP Integrator](https://docs.amd.com/r/2022.1-English/ug994-vivado-ip-subsystems/Designing-with-IP-Integrator)
- [React Flow](https://reactflow.dev/learn)
- [Eclipse Layout Kernel layered layout](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)

React Flow is used for interaction and viewport behavior. ELK computes compound block placement. React Flow Smart Edge provides grid-based obstacle-aware orthogonal routing; Architecture Block Studio supplies React Flow's absolute compound-node geometry so nested routes cannot cross unrelated blocks. Dockview provides resizable, collapsible, maximizable and movable IDE panels. Architecture Block Studio owns its document model, visual language, validation and application shell. Dependency license details are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

MIT. See [LICENSE](LICENSE).
