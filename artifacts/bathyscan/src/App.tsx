import React, { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGetDatasets } from "@workspace/api-client-react";
import { AppProvider, useAppState } from "@/lib/context";
import { TourScene } from "@/pages/TourScene";
import { HUD } from "@/components/HUD";
import { DatasetPicker } from "@/components/DatasetPicker";
import { FileUpload } from "@/components/FileUpload";
import { DepthLegend } from "@/components/DepthLegend";

const queryClient = new QueryClient();

function Main() {
  const { data: datasets, isLoading: datasetsLoading } = useGetDatasets();
  const { datasetId, setDatasetId, terrain } = useAppState();

  // Set the initial dataset to the first available one
  useEffect(() => {
    if (datasets?.length && !datasetId) {
      setDatasetId(datasets[0]?.id ?? null);
    }
  }, [datasets, datasetId, setDatasetId]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#040810]">
      {/* 3D scene fills the entire viewport */}
      <TourScene />

      {/* HUD overlay — pointer-events disabled so scene receives input */}
      <div className="absolute inset-0 pointer-events-none z-10">
        <HUD />
        {terrain && <DepthLegend />}
      </div>

      {/* Dataset / upload controls — top-right corner */}
      <div className="absolute top-6 right-6 z-20 w-80 space-y-4">
        <DatasetPicker datasets={datasets ?? []} isLoading={datasetsLoading} />
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
