import React from "react";
import type { DatasetMeta } from "@workspace/api-client-react";
import { useAppState } from "@/lib/context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";

export const DatasetPicker = ({ datasets, isLoading }: { datasets: DatasetMeta[], isLoading: boolean }) => {
  const { datasetId, setDatasetId } = useAppState();

  return (
    <Card className="bg-background/80 backdrop-blur-md border-border text-foreground pointer-events-auto">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex justify-between items-center">
          <span>Datasets</span>
          {isLoading && <Spinner className="w-4 h-4 text-primary" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-64">
          <div className="flex flex-col space-y-1 p-2">
            {datasets.map(ds => (
              <ViewscreenTooltip key={ds.id} label={`Load ${ds.name}`} side="right">
              <button
                data-testid={`btn-dataset-${ds.id}`}
                onClick={() => setDatasetId(ds.id)}
                className={`text-left p-3 rounded-md transition-colors ${
                  datasetId === ds.id 
                    ? "bg-primary/20 border border-primary/50" 
                    : "hover:bg-muted"
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="font-semibold text-sm truncate pr-2">{ds.name}</span>
                  <Badge variant={ds.waterType === "saltwater" ? "default" : "secondary"} className="text-[10px] uppercase">
                    {ds.waterType}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground flex justify-between">
                  <span>{ds.minDepth}m - {ds.maxDepth}m</span>
                </div>
              </button>
              </ViewscreenTooltip>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};