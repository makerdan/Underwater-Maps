import React, { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useListDatasets, useGetDatasetTerrain, getGetDatasetTerrainQueryKey } from "@workspace/api-client-react";
import { AppProvider, useAppState } from "@/lib/context";
import { TerrainScene } from "@/components/TerrainScene";
import { HUD } from "@/components/HUD";
import { DatasetPicker } from "@/components/DatasetPicker";
import { FileUpload } from "@/components/FileUpload";
import { DepthLegend } from "@/components/DepthLegend";

const queryClient = new QueryClient();

function Main() {
  const { data: datasets } = useListDatasets();
  const { datasetId, setDatasetId, setTerrain, terrain } = useAppState();

  useEffect(() => {
    if (datasets?.length && !datasetId) {
      setDatasetId(datasets[0].id);
    }
  }, [datasets, datasetId, setDatasetId]);

  const { data: fetchedTerrain, isLoading } = useGetDatasetTerrain(datasetId || "", {
    query: {
      enabled: !!datasetId,
      queryKey: getGetDatasetTerrainQueryKey(datasetId || "")
    }
  });

  useEffect(() => {
    if (fetchedTerrain) {
      setTerrain(fetchedTerrain);
    }
  }, [fetchedTerrain, setTerrain]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-background text-foreground dark">
      <TerrainScene />
      
      <div className="absolute inset-0 pointer-events-none z-10">
        <HUD />
        {terrain && <DepthLegend />}
      </div>

      <div className="absolute top-6 right-6 z-20 w-80 space-y-4">
        <DatasetPicker datasets={datasets || []} isLoading={isLoading} />
        <FileUpload />
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppProvider>
          <Main />
        </AppProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;