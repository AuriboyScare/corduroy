#!/bin/bash
# SessionStart: show current priorities and warn when the disk is nearly full.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
free_gb=$(df -g /System/Volumes/Data 2>/dev/null | awk 'NR==2 {print $4}')
if [ -n "$free_gb" ] && [ "$free_gb" -lt 5 ]; then
  echo "WARNING: only ${free_gb} GB free on disk. macOS and the game become unstable below ~5 GB."
fi
awk '/^## Next priorities/{on=1} on&&/^## /&&!/Next priorities/{exit} on' DEVELOPMENT_STATUS.md 2>/dev/null
