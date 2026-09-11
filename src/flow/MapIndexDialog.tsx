import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MapIndexBody } from "./mapLegend";

export function MapIndexDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="icon" title="Index" aria-label="Index">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[min(80vh,640px)] overflow-y-auto"
        aria-describedby="map-index-description"
      >
        <DialogHeader>
          <DialogTitle>Index</DialogTitle>
          <DialogDescription id="map-index-description">
            Controls for the canvas, and what each colour and mark on the map means.
          </DialogDescription>
        </DialogHeader>
        <MapIndexBody />
      </DialogContent>
    </Dialog>
  );
}
