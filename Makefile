# meiosis-atlas — make targets for the catalogue-forwarding loop.
#
# Quick reference:
#   make catalogue          regenerate catalogue_outbound/ (JSONL + tarball)
#   make smoke              run every smoke suite (Python + Node)
#   make tarball            re-bundle catalogue_outbound.tar.gz only
#   make ship               regenerate + smoke + bundle in one go (safe default)
#   make catalogue-push     copy tarball into a sibling atlas-core checkout
#                           (set ATLAS_CORE_REPO=path/to/atlas-core to override)
#   make clean              remove generated catalogue_outbound/ artefacts
#   make help               this list
#
# Each target is idempotent — `make ship` is the canonical "I changed
# something, push it forward" workflow.

PY            ?= python3
NODE          ?= node
HERE          := $(CURDIR)
REGISTRY_DIR  := $(HERE)/atlases/meiosis/registries
PAGES_DIR     := $(HERE)/atlases/meiosis/pages/hub
OUTBOUND_DIR  := $(REGISTRY_DIR)/catalogue_outbound
TARBALL       := $(OUTBOUND_DIR)/meiosis_catalogue_outbound.tar.gz

# Path to the atlas-core checkout where the forwarding payload should land.
# Defaults to a sibling repo; override with `make catalogue-push ATLAS_CORE_REPO=...`.
ATLAS_CORE_REPO ?= $(realpath $(HERE)/../atlas-core)
ATLAS_CORE_DROP := $(ATLAS_CORE_REPO)/toolkit_registries/meiosis/01_registry

GEN_SCRIPT    := $(REGISTRY_DIR)/generate_catalogue_outbound.py
PY_TESTS      := $(wildcard $(REGISTRY_DIR)/test_*.py)
JS_TESTS      := $(wildcard $(PAGES_DIR)/test_*.js) $(wildcard $(HERE)/atlases/meiosis/shared/test_*.js)


.PHONY: help catalogue smoke smoke-py smoke-js tarball ship catalogue-push clean

help:
	@grep -E '^# ' Makefile | head -25 | sed 's/^# //'

catalogue:
	@echo ">> regenerating catalogue_outbound/ ..."
	@$(PY) $(GEN_SCRIPT)

smoke: smoke-py smoke-js
	@echo ">> all smoke suites OK"

smoke-py:
	@echo ">> python smoke suites ..."
	@for t in $(PY_TESTS); do \
		echo "--- $$t"; \
		$(PY) $$t || exit 1; \
	done

smoke-js:
	@echo ">> node smoke suites ..."
	@for t in $(JS_TESTS); do \
		echo "--- $$t"; \
		$(NODE) $$t || exit 1; \
	done

# Re-bundle the tarball without re-running the generator. Useful when the
# JSONL files were hand-edited (rare) or when atlas-core needs a fresh tar
# from already-correct contents.
tarball:
	@echo ">> rebuilding tarball ..."
	@cd $(REGISTRY_DIR) && tar -czf $(TARBALL) \
		-C catalogue_outbound \
		README.md module_registry.jsonl analysis_registry.jsonl \
		analysis_modes.jsonl layer_registry.jsonl pages_registry.jsonl \
		--transform 's,^,catalogue_outbound/,'
	@echo ">> tarball: $(TARBALL) ($$( wc -c < $(TARBALL) ) bytes)"

# Canonical "I changed something" workflow: regenerate everything, then
# re-validate. Catches any drift between actions.registry.json,
# catalogue_outbound_config.json, and the JSONL output.
ship: catalogue smoke
	@echo ">> ship: catalogue regenerated + smoke OK"
	@echo ">> next: git add -A && git commit && git push"

# Push the forwarding payload into a sibling atlas-core checkout. Refuses
# when the target directory is missing (so the user fixes ATLAS_CORE_REPO
# instead of getting a partial copy). Uses tar --strip-components=1 so the
# 5 JSONL files + README land directly in 01_registry/.
catalogue-push: catalogue
	@if [ -z "$(ATLAS_CORE_REPO)" ] || [ ! -d "$(ATLAS_CORE_REPO)" ]; then \
		echo "!! ATLAS_CORE_REPO=$(ATLAS_CORE_REPO) does not exist."; \
		echo "   Set it explicitly: make catalogue-push ATLAS_CORE_REPO=path/to/atlas-core"; \
		exit 1; \
	fi
	@echo ">> pushing catalogue to $(ATLAS_CORE_DROP) ..."
	@mkdir -p $(ATLAS_CORE_DROP)
	@tar -xzf $(TARBALL) -C $(ATLAS_CORE_DROP) --strip-components=1
	@echo ">> done. atlas-core needs git add + commit for the change to land."

clean:
	@echo ">> removing generated artefacts ..."
	@rm -f $(OUTBOUND_DIR)/*.jsonl
	@rm -f $(TARBALL)
	@echo ">> clean. Run 'make catalogue' to regenerate."
