# Roadmap

This is a lightweight list to keep future work consistent and easy for AI agents.

## Data quality
- [ ] Introduce stable `id` for every resort entrypoint
- [ ] Introduce `verbund.id` for groups/networks
- [ ] Validate resorts.json against `/schemas/resorts.schema.json`

## UX
- [ ] Unified search: by resort name OR by verbund id
- [ ] Clear "active filters" indicator
- [ ] Better empty-state message (0 results)

## Performance
- [ ] Cache travel times per home location (homeKey)
- [ ] Avoid recomputing travel times if cached and still valid
