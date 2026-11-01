# A child repo keeps the template's ADRs in their own folder and drops its specs

A repo made from this template gets every file in it. Some of those files are decisions the child
inherits along with the code they govern: ADR-0001 is why the workflow and the pre-push hook exist,
ADR-0002 is what authorises `scripts/jev/` to call `api.typesafe.ai`, ADR-0003 governs the eval
runner and the guard-safe tracker commands. About 28 files cite them. Other files are only the
template's history: its specs describe how the template was built, not what the child will build.
Both kinds also carry bare issue refs, a hash and a number, which in a child point at its own,
unrelated issues.

**So the template's ADRs ship, in `docs/adr/template/`, and its specs do not.** Every ADR the
template records goes in `docs/adr/template/`, numbered on its own; a child's ADRs start at
`docs/adr/0001`. `scripts/bootstrap.sh` removes the template's specs from a new child in one local
commit, keeping `docs/specs/README.md` so the folder and the links to it survive.
Issue refs in a template ADR name the template repo: `altpsyche/altpsyche-agentic-engineering#55`.

## Consequences

- **Porting never collides.** The template keeps adding ADRs, and a child may copy a later one in
  by hand; nothing links the two repos. With one shared numbering, a child that wrote its own 0004
  could not take the template's 0004; in separate folders both keep their numbers.
- **A child may supersede a template ADR, never edit it.** It writes its own ADR naming the one it
  supersedes and leaves the inherited file as it came, so a later port applies cleanly. The
  precedence rule in `AGENTS.md` treats both folders as ADRs; the superseding one wins.
- **Removal is gated on a sentinel.** Bootstrap is rerun after adding a phase, and by then the
  child has specs of its own. The template ships `docs/specs/.from-template`; bootstrap removes
  every file in `docs/specs/` but its `README.md` only while the sentinel exists, and the removal
  deletes the sentinel, so every rerun is a no-op. Bootstrap also skips the removal when the repo
  is the template itself. It commits before it sets the rulesets, and the owner pushes that commit
  with the admin bypass. If the commit fails, bootstrap restores what it removed, sentinel
  included, so the tree is clean and a rerun tries again.
- **Links into the removed specs become absolute.** A file that ships and links a template spec,
  such as ADR-0001's link to the guardrails spec, links the template repo on GitHub instead. Links
  to the folder itself stay, since its `README.md` keeps it in git.
- **`check-skills.mjs` fails on a bare issue ref under `docs/adr/template/`.** A child writes there
  only when porting, so the check has no false hits; the specs need no check, since they never
  reach a child.

## Considered options

- **Bootstrap deletes the ADRs too.** Rejected: the code they govern stays, and a Jev script
  calling an outside host with no ADR behind it is exactly what ADR-0002 exists to prevent.
- **One numbering, with a README note marking 0001–0003 as inherited.** No ref churn, but every
  later template ADR collides with the child's own numbers.
- **A `T-` prefix in the same folder.** As much churn as a folder, and it breaks the
  `NNNN-kebab-title.md` naming every ADR follows.
- **A named list of template specs in `bootstrap.sh`.** Every new template spec would need adding,
  or it leaks into children. At bootstrap a child has written no spec, so all of `docs/specs/` is
  the template's.
