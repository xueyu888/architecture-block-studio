import { requestedDesignUrl } from "./io/loadDesign";
import { BlockDesignStudio } from "./studio";

export default function App() {
  return (
    <BlockDesignStudio
      initialDesignUrl={requestedDesignUrl() ?? "/examples/aio-agent-runtime.block-design.json"}
      initialSourceLabel="examples/aio-agent-runtime.block-design.json"
    />
  );
}
