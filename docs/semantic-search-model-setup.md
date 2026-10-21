# Semantic Search — Model Setup

## The easy way

Settings → Rico Obsidian Plugin Suite → Semantic Search → **Models**.

Pick a model and press **Download**. It fetches four files from HuggingFace and
shows progress you can cancel. When the badge turns **Ready**, you are done —
nothing touches the network again after that.

Notes:
- Downloads only start when you press the button.
- A cancelled or failed download keeps whatever it already fetched; press
  **Resume** to carry on.
- **Delete** removes a model from disk.
- On mobile the row shows the size, since these are large over mobile data.

Then skip to [step 4](#4-index-the-vault).

---

## The manual way

If you would rather place the files yourself, or the download cannot reach
HuggingFace from your network.

## 1. Pick the folder

Default location, relative to your vault root:

```
.models/multilingual-e5-small/
```

The folder name must match the model key exactly. Change the parent folder in
Settings → Rico Obsidian Plugin Suite → Semantic Search → Model folder.

## 2. Download the files

Default model: **multilingual-e5-small** — handles Indonesian and English,
about 120MB.

From <https://huggingface.co/Xenova/multilingual-e5-small/tree/main>, download:

| File | Put it at |
| --- | --- |
| `config.json` | `.models/multilingual-e5-small/config.json` |
| `tokenizer.json` | `.models/multilingual-e5-small/tokenizer.json` |
| `tokenizer_config.json` | `.models/multilingual-e5-small/tokenizer_config.json` |
| `onnx/model_quantized.onnx` | `.models/multilingual-e5-small/onnx/model_quantized.onnx` |

Keep the `onnx/` subfolder — the loader looks for that exact path.

The result should look like:

```
.models/
└── multilingual-e5-small/
    ├── config.json
    ├── tokenizer.json
    ├── tokenizer_config.json
    └── onnx/
        └── model_quantized.onnx
```

### Other models

Same four files, same layout, just a different folder name and repo:

| Model key | HuggingFace repo |
| --- | --- |
| `multilingual-e5-small` | `Xenova/multilingual-e5-small` |
| `multilingual-e5-base` | `Xenova/multilingual-e5-base` |
| `paraphrase-multilingual-MiniLM-L12-v2` | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` |
| `all-MiniLM-L6-v2` | `Xenova/all-MiniLM-L6-v2` |

`all-MiniLM-L6-v2` is English-only and will give poor results on Indonesian notes.

## 3. Check it

Command palette → **Semantic search: check model**.

You should see "Model ready". If files are missing, the notice names each one.

## 4. Index the vault

Command palette → **Semantic search: index vault**.

First run embeds every markdown note, so it takes a while on a large vault.
After that only edited notes are re-embedded.

## 5. Use it

Click the magnifier icon in the ribbon, or run **Open related notes**. Open any
note and related ones appear with a match percentage.

---

## Troubleshooting

**"Model is not in …"** — the folder name must match the model key, and `onnx/`
must be a real subfolder.

**Results look random** — you are probably on an English-only model with
Indonesian notes. Switch to a multilingual one, then re-index.

**Nothing appears after switching models** — vectors from different models are
not comparable, so the index resets by design. Run "index vault" again.

**Hidden folder is invisible** — `.models` starts with a dot, so Obsidian hides
it. That is fine; the plugin still reads it. Use your file manager, or rename
the folder to something without the dot and update the setting.
