#!/usr/bin/env python3
"""Generates one WAV per narration line with macOS `say`, and writes timings to assets/narration.json."""
import json, os, re, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
script = json.load(open(os.path.join(here, 'script.json')))
out_dir = os.path.join(here, 'assets', 'voice')
os.makedirs(out_dir, exist_ok=True)
result = []
for scene in script['scenes']:
    for i, line in enumerate(scene['lines']):
        name = f"{scene['id']}-{i}.wav"
        path = os.path.join(out_dir, name)
        subprocess.run(['say', '-v', script['voice'], '-r', str(script['rate']),
                        '--file-format=WAVE', '--data-format=LEI16@24000', '-o', path, line['say']], check=True)
        info = subprocess.run(['afinfo', path], capture_output=True, text=True, check=True).stdout
        dur = float(re.search(r'estimated duration: ([\d.]+)', info).group(1))
        result.append({'scene': scene['id'], 'index': i, 'file': f'voice/{name}', 'duration': dur})
json.dump(result, open(os.path.join(here, 'assets', 'narration.json'), 'w'), indent=1)
total = sum(r['duration'] for r in result)
print(f'{len(result)} lines, {total:.1f}s of speech')
