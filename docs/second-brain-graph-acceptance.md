# Second Brain graph acceptance runbook

Use a 1,000-note fixture vault. Record the app version, browser, GPU, fixture hash, and a link to the exported browser performance trace for every run.

## Automated guards

- `npm test -w @timeblock/server -- --run src/notes/graph/graphAcceptance.test.ts` builds a 1,000-note weekly frame, verifies sparse edges, and requires at least 80% correct era-region labels in the labelled fixture.
- `npm test -w @timeblock/server -- --run src/notes/graph/timeTravel.test.ts` verifies snapshot timestamp parsing, weekly boundaries, historical links, centrality, and era community labels.
- `npm run build -w @timeblock/web` type-checks the Sigma interaction layer and produces the production bundle.

## Browser performance trace

1. Open the graph with the 1,000-note vault and Chrome DevTools Performance.
2. Record 10 seconds while continuously panning and zooming, then stop the trace.
3. Confirm the graph canvas has `data-renderer="webgl"`, ForceAtlas runs in its worker, there are no long layout tasks on Main, and the frame chart remains at 60 fps on the reference machine.
4. Export the trace and attach it to the release evidence. Test reduced-motion separately.

## Intelligence acceptance

1. Semantic map: use the hand-labelled sample and record correct-region / sample-size. Pass at 80% or higher; inspect country, city, and street labels independently.
2. Global GraphRAG: ask “what are the main themes here?”. Every substantive claim must have a clickable note citation, and “Show on graph” must highlight the cited subgraph.
3. Connection explorer: choose the fixture’s two documented seed notes. Confirm both the animated path and narration match the known multi-hop chain.
4. Ghost edges: review the fixed 20-pair suggestion sample without seeing its labels. Pass at 15 genuinely related pairs or more; keep accept/dismiss decisions as evidence.
5. Discoverability: from a cold graph open, time finding one orphan, one blind spot, and one stale-but-central note. Each must take 10 seconds or less.

The human-reviewed checks are intentionally not replaced with synthetic assertions: semantic correctness, narrated-path quality, and suggestion precision require the labelled fixture and reviewer evidence.
