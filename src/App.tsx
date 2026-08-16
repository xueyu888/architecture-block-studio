import { requestedDesignUrl } from "./io/loadDesign";
import aioAgentRuntimeDesign from "../public/examples/aio-agent-runtime.block-design.json";
import { BlockDesignStudio } from "./studio";

export default function App() {
  return (
    <BlockDesignStudio
      initialDocument={aioAgentRuntimeDesign}
      initialDesignUrl={requestedDesignUrl()}
      initialSourceLabel="examples/aio-agent-runtime.block-design.json"
    />
  );
}
