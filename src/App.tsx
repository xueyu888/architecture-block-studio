import { requestedDesignUrl } from "./io/loadDesign";
import { StudioLocaleProvider } from "./i18n/StudioLocale";
import { BlockDesignStudio } from "./studio";

export default function App() {
  return (
    <StudioLocaleProvider>
      <BlockDesignStudio
        initialDesignUrl={requestedDesignUrl() ?? "/examples/aio-agent-runtime.block-design.json"}
        initialSourceLabel="examples/aio-agent-runtime.block-design.json"
      />
    </StudioLocaleProvider>
  );
}
