# Project Guidelines & Rules

## Token-Efficient Codebase Analysis & Retrieval (Graphify-First)
To eliminate token waste and prevent context window exhaustion:
- **Never dump large raw source files** into context just to understand code flow or search symbols.
- **Always query graphify first**:
  - Run `python -m graphify query "<question>" --budget 1000` to pinpoint exact node locations and line numbers.
  - Trace connections with `python -m graphify path "Source" "Target"` and `python -m graphify explain "Node"`.
  - Consult `graphify-out/GRAPH_REPORT.md` and `graphify-out/wiki/index.md` for architecture and community structure.
- **Surgical line reads only**: Once graphify locates the target, use `read_file` with narrow line bounds (`StartLine`/`EndLine`, max 30–60 lines).
- **Keep graph synchronized**: Run `python -m graphify update .` after code edits (AST-only, 0 LLM cost).

