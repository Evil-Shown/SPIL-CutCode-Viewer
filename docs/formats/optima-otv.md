# Optima OTV (JSON viewer format)

OptiTV `.otv` files are single-line JSON documents describing an optimization
project. Structure:

```json
{
  "parameters": { "projectName": "...", "unitOfMeasurement": "mm", ... },
  "subProjects": [
    {
      "glassFamily": "3mm Clear",
      "glassThickness": 3.2,
      "pieces": [ { "id": 1, "width": 800, "height": 600, ... } ],
      "sheets": [ { "width": 3660, "height": 2440, "glassCode": "..." } ],
      "layout": [
        {
          "width": 3660, "height": 2440,
          "piecePlacement": [ { "id": 1, "x": 0, "y": 0, "rotated": false } ],
          "cutLines": [ { "id": 1, "stage": 1, "x1": 0, "y1": 0, "x2": 100, "y2": 0 } ]
        }
      ]
    }
  ]
}
```

## Parser notes (`optima-otv.ts`)

- **Multi-sheet**: every subProject × layout entry becomes one `CutPlan`
  (sheet id `sheet-<sub>-<layout>`).
- **Rotation**: `piecePlacement.rotated` swaps width/height; the pane is
  flagged `rotated` (rendered teal).
- **Stages**: `cutLines.stage` maps to the Optima stage labels (X, Y, Z, W, V, …).
- Coordinates are already in top-left/mm space; no normalization flip.
- Piece labels/note fields and per-piece customer data are not extracted yet.
