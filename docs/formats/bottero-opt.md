# Bottero OPT

## Detection
- Lines `[P\d+H\d+R…]` with hex coordinate tokens

## coordinateSemantics
- Origin: top-left (heuristic)
- Units: internal hex ticks × 1/16 → mm (from qiewer token stream analysis)

## Token grammar (heuristic)
- `P#H#R#` — piece, head, rack
- `xNNNyNNN` — piece dimensions mm
- `X/Y/Z/W` + hex — coordinates

## Note
Refine scale against Ghidra MCP on qiewer opt reader if renders drift.
