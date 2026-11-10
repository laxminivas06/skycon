# Token-Efficient Codebase Analysis & Retrieval Rule (Graphify-First)

## Mandatory Directive: Zero Token Waste on Codebase Analysis
To prevent context window bloat and eliminate token waste during code analysis, debugging, symbol lookup, and architecture investigation:

1. **Strictly Forbid Large Raw-File Dumps:**
   - NEVER read multi-hundred or multi-thousand line source files (e.g., `mavlinkService.ts`, `server.js`, `DashboardPage.tsx`, `PreflightValidationModal.tsx`) just to investigate behavior, search for functions, or understand relationships.
   - Reading massive files into the prompt wastes 10,000–50,000+ tokens per call and exhausts context budget.

2. **Always Use Graphify for Information Retrieval:**
   - **Step 1: Graph Traversal Query**:
     Run `python -m graphify query "<question or symbol>" --budget 1000` (or `python -m graphify explain "<NodeName>"` / `python -m graphify path "<Source>" "<Target>"`).
     This extracts exact node definitions, community IDs, source file paths, and exact line numbers (`loc=Lxxx`) in < 1,000 tokens.
   - **Step 2: Wiki & Report Navigation**:
     Consult `graphify-out/GRAPH_REPORT.md` (for god nodes and community architecture) or `graphify-out/wiki/index.md` before touching code files.
   - **Step 3: Surgical, Line-Bounded Reads Only**:
     When code inspection is required, use `read_file` with explicit `StartLine` and `EndLine` bounded to ONLY the relevant lines identified by Graphify (maximum 30–60 lines). NEVER read unbounded files.

3. **Keep Knowledge Graph Synchronized**:
   - After editing code files, run `python -m graphify update .` to keep `graphify-out/` synchronized. This runs pure AST parsing with zero LLM API costs or token usage.
