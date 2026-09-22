# FuturePlural parser field test

Use a fresh copy of this note in **dev-vault**. Switch to Reading view, then open the Highlights Navigator. Before making any changes, it should contain **12 entries**, starting with P01 through P12. There are no groups and no footnotes in this baseline.

The code, comment, escaped-syntax, and attribute examples labelled NEG must never become Navigator entries. Some are deliberately invisible in Reading view; inspect Source mode to see their actual Markdown. Use the Navigator to check recognition: the presence of yellow on screen alone does not prove the parser found anything.

## 1. Native and legacy marks

==P01 Native Markdown yellow.==

<mark>P02 Bare HTML mark, using the theme's usual highlight.</mark>

<mark style="background-color: #efbc8b80">P03 Legacy peach with alpha in its inline color.</mark>

Expected: three ordinary highlights, with no rough gestures. P03 retains its own color. P01 and P02 retain the theme's default appearance.

## 2. Actual source-line breaks

This paragraph contains <mark style="background-color: #c8e6c980">P04 A single legacy highlight
whose HTML wrapper crosses
three actual source lines.</mark> The Navigator must show ONE entry for the complete passage. These are source newlines, not merely text wrapping on screen.

This paragraph contains <mark
style="background-color: #bbdefb80"
title="A > B">P05 An opening tag spread over source lines, with an angle bracket in a quoted attribute.</mark>

This paragraph contains <mark style="background-color: #fff9c480">P06 A passage with <strong>bold text</strong> inside the wrapper.</mark>

Expected: three more entries. Inline formatting stays inside its original wrapper. The Navigator currently shows source text for inline HTML, so seeing a formatting tag in its text is not evidence of an extra highlight.

## 3. FuturePlural rendering

<mark data-fp-notation="underline" data-fp-color="#8fa58f" data-fp-opacity="0.8">P07 This underline should be rough.</mark>

This paragraph contains <mark data-fp-notation="highlight" data-fp-color="#f3c969" data-fp-opacity="0.6">P08 A rough highlight
that also crosses a source newline.</mark> Resize the note by opening and closing the sidebar; the gesture should follow the text.

Expected: two rough marks. Only these two baseline entries belong to FuturePlural's renderer.

## 4. Ordinary document structures

- ==P09 A native highlight inside a list item.==
- A neighbouring item without a highlight.

> <mark>P10 A bare mark inside a blockquote.</mark>

| Context | Passage                                                                                 |
| ------- | --------------------------------------------------------------------------------------- |
| Table   | <mark style="background-color: #d1c4e980">P11 A legacy mark inside a table cell.</mark> |

📚 🐕 Before the mark: <mark>P12 Unicode before this mark must not shift its source positions.</mark> After the mark.

Expected: four more ordinary entries. Total so far: 12.

## 5. Examples that must not enter the Navigator

### Backtick fence

```html
<mark style="background: red">NEG01 fenced HTML example</mark> ==NEG02 fenced Markdown example==
```

### Tilde fence

```markdown
==NEG03 tilde-fenced example==
<mark>NEG04 another fenced example</mark>
```

### A fence inside a blockquote

> ```html
> <mark>NEG05 quoted code example</mark>
> ```

### Inline code

Here is code: `==NEG06 inline Markdown example==`. Here is more code: `<mark>NEG07 inline HTML example</mark>`.

### HTML comment

The following hidden comment is present in Source mode only.

<!-- <mark>NEG08 hidden HTML example</mark> ==NEG09 hidden Markdown example== -->

### Escaped markup

\<mark>NEG10 escaped opening tag\</mark>

\==NEG11 escaped opener==

### Indented code

    <mark>NEG12 indented HTML example</mark>
    ==NEG13 continued indented code==

### HTML code container

<pre><code>==NEG14 HTML code example==</code></pre>

### Markup written inside an attribute

<span title="<mark>NEG15 attribute HTML</mark> and ==NEG16 attribute Markdown==">This ordinary span is not a highlight.</span>

Expected: the Navigator still contains exactly 12 entries. Search for NEG in the Navigator: zero results.

## 6. Make new marks here

Turn automatic grouping off for this exercise, if it is enabled. Select only the requested words, choose the notation button, then choose a color. Check that each action adds one Navigator entry and affects only the selected phrase.

1. Choose Highlight, then mark just **amber lantern** in this sentence.
2. Choose Underline, then mark just **quiet shoreline** in this sentence.
3. Choose Box, then mark just **small compass** in this sentence.
4. Choose Circle, then mark just **paper moon** in this sentence.
5. Choose Strikethrough, then mark just **old assumption** in this sentence.
6. Choose Crossed-off, then mark just **discarded route** in this sentence.

After all six actions, expect 18 Navigator entries. Remove the six new marks using the plugin: the count should return to 12. Save and reopen this note; the baseline should still be intact.

## 7. Editing and Canvas checks

Use a second copy of this note for these checks, so the baseline above remains reusable.

- In the Navigator, change the color of P04. All three source lines should remain one mark, with surrounding text unchanged. Then remove that mark: the text should remain; only its wrapper should disappear.
- Remove P12. The emoji and the text before and after it must remain intact.
- Click Manage in the sidebar. The tab title should be Annotations manager. Select just this file in the file picker; the visible results and Canvas export count should agree.
- Click Create Canvas in the sidebar. It should become Add to Canvas. Click it again: it should reopen the same associated canvas and add no duplicates.
- Move a card and add a handwritten text card to that canvas. Add a new highlight to this note, then click Canvas again. The old cards should stay put, and one new card should appear below the existing layout.
- Rename this note while the plugin is enabled, with Obsidian's automatic link updating enabled. Add to Canvas should still open the associated canvas. Hover the link symbol on a new-format card to inspect its source. The card should not contain a stale displayed filename.

The new review/migration workflow is a later feature; this note does not test it.
