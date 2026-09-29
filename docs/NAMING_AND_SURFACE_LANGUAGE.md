# Finders Keepers — naming and surface-language decisions

**Status:** current naming direction, settled 2026-09-25  
**Scope:** public plugin identity, primary surface names, discoverability/provenance rules, and related domain-language boundaries.

## 1. Public product identity

The plugin is named **Finders Keepers**.

Use the ordinary idiom without an apostrophe.

Current intended identifiers:

- **Public/plugin name:** `Finders Keepers`
- **Obsidian plugin ID:** `finders-keepers`
- **GitHub repository:** `finders-keepers`
- **Repository/product slug:** `finders-keepers`

The repository name deliberately does **not** include `obsidian`.

The plugin is intrinsically an Obsidian plugin, and that context will already be explicit in the repository description, README, Community Plugins listing, manifest, and surrounding documentation. Adding `obsidian` to the repository name provides little additional value and makes the repository identity less cleanly aligned with the product and plugin ID.

If Finders Keepers ever develops into a substantially broader product family, that future identity can acquire an additional word or institutional qualifier then. There is no need to solve that hypothetical now.

## 2. Why “Finders Keepers” fits

The name is an existing phrase with a rich meaning rather than a newly manufactured software-brand word.

Its ordinary reading has a slightly mischievous, humorous attitude: _I found this; I’m keeping it._

That maps unusually well onto annotation work. A reader encounters someone else’s useful phrasing, observation, contradiction, evidence, question, or idea and marks it for themselves.

There is also a useful underlying mental model:

- while reading, the user is **finding** things;
- later, deliberate sensemaking determines what becomes worth **keeping**, connecting, interpreting, or using.

This “finders / keepers” distinction should not be forced into literal product terminology or explained as a formal architecture. Its value is that the name naturally fits the activity without requiring explanation.

The name also survives ordinary software-language tests:

- Open Finders Keepers
- Finders Keepers settings
- Install Finders Keepers
- Made with Finders Keepers
- Mark it up with Finders Keepers
- Open Finders Keepers Workspace

That grammatical flexibility was an important part of the decision.

## 3. Primary surfaces

Finders Keepers currently has two primary working surfaces.

### Finders Keepers

The note-adjacent sidebar surface is named simply:

**Finders Keepers**

Do not name it:

- Annotations
- Finders Keepers: Annotations
- Finders Keepers Sidebar
- Annotation Navigator

The fact that the view happens to occupy an Obsidian sidebar is container information, not the user-facing identity of the tool.

“Finders Keepers” is also the primary, everyday mode of interaction while reading, so the unqualified product name is appropriate for this surface.

### Finders Keepers Workspace

The larger sensemaking surface is named:

**Finders Keepers Workspace**

“Workspace” usefully distinguishes the larger, more deliberate environment from the everyday note-adjacent Finders Keepers surface.

It should be independently launchable. Users should not have to discover or open the sidebar first in order to reach Workspace.

## 4. Recognition over recall

Primary surface names must preserve **product provenance**.

This is a discoverability requirement, not decorative branding.

A user may install Finders Keepers, use it once, switch the sidebar to Outline or Backlinks, and return days later. At that point they are scanning the interface for the plugin they remember installing.

A sidebar tab called only **Annotations** requires the user to remember:

> “Finders Keepers called its sidebar Annotations.”

A tab called **Finders Keepers** allows direct recognition.

The same applies to commands, ribbon actions, tabs, settings, and other Obsidian-level entry points.

Generic names can create the false impression that a surface is an Obsidian core capability or can make the installed plugin difficult to find. This is the same failure mode seen when a plugin named for one thing exposes actions and surfaces only under generic labels.

Therefore:

> **At Obsidian-level boundaries, preserve the Finders Keepers name.  
> Inside Finders Keepers, use plain domain language.**

## 5. Commands and launch affordances

Command Palette and other launch affordances should preserve the product retrieval cue.

Baseline wording:

- **Open Finders Keepers**
- **Open Finders Keepers Workspace**

Equivalent ribbon tooltips should also include **Finders Keepers**.

Searching the Command Palette for `Finders Keepers` should reveal the plugin’s primary destinations immediately.

Do not rely on commands such as merely:

- Open annotations
- Open workspace

Those names discard the strongest recognition cue available to someone looking for the plugin they installed.

Exact verb wording may still evolve during interface work.

## 6. Product naming vs domain vocabulary

The product name and the domain ontology do different jobs.

**Finders Keepers** answers:

> Whose interface / tool is this?

Domain words answer:

> What are the things inside it?

The naming decision therefore does **not** retire the conceptual vocabulary already developed.

**Annotations** remains the system-wide domain term.

Annotations currently comprise:

- visual annotations
- footnotes

The visual-annotation category is currently called **Highlights**, with **Markings** retained as a serious alternative.

This conceptual vocabulary remains useful throughout:

- UX writing
- documentation
- filtering
- analysis
- schema/domain naming where appropriate
- explanation of the product

The primary surface does not need to be titled “Annotations” merely because annotations are the objects shown there.

## 7. Highlights vs Markings remains open

The collective term for visual annotation treatments is not yet settled.

Current possibilities:

**Highlights**

- familiar;
- already in use;
- but creates a category/member collision when one notation type is itself “highlight”.

Example:

- Highlights
    - Highlight
    - Underline
    - Circle
    - Box

**Markings**

- avoids that collision;
- accommodates multiple deliberately distinct visual forms naturally.

Example:

- Annotations
    - Markings
        - Highlight
        - Underline
        - Circle
        - Box
        - Bracket
        - Strike-through
    - Footnotes

This should be tested in actual interface sketches rather than decided abstractly.

The distinction may become more important if the sidebar exposes notation type compactly and if notation shapes carry meaningful user semantics.

No rename is authorized merely by this naming decision.

## 8. Internal namespace

The existing implementation contains `fp` / FuturePlural-derived internal identifiers.

The intended Finders Keepers namespace is `fk`, for example:

- CSS/internal class prefixes: `fk-...`
- managed source attributes: `data-fk-...`
- internal IDs or other implementation identifiers where a product namespace is appropriate

There is currently **no production data or compatibility baseline that needs to be preserved**.

All existing managed markup, registry data, fixtures, renderer probes, adapter spikes, test notes, and related FuturePlural-prefixed development artifacts exist only in the dedicated development environment. They are disposable pre-release material used to exercise the implementation. There is no valuable corpus in the personal vault, no released user base depending on the current representation, and no migration obligation from `fp` to `fk`.

Accordingly, the rename should optimize for **coherence of the new implementation**, not backward compatibility with disposable development state.

Where practical, replace FuturePlural-derived product namespaces with Finders Keepers equivalents cleanly rather than retaining compatibility aliases or transitional readers.

Existing test fixtures and spike documents may be:

- updated in place;
- regenerated;
- rewritten from scratch;
- or discarded and recreated as needed.

Breaking old development fixtures is acceptable if the current tests and validation artifacts are updated to exercise the intended representation.

The point at which Finders Keepers begins creating valuable real-vault data will establish the actual compatibility baseline. After that point, changes to persisted or source-facing representations must follow the normal migration and compatibility discipline.

## 9. Working naming principle

The durable rule is:

> **Use Finders Keepers to establish provenance and enable recognition.  
> Use ordinary domain vocabulary once the user is already inside that context.**

This gives the plugin a recognizable identity without turning every domain concept into branded terminology.
