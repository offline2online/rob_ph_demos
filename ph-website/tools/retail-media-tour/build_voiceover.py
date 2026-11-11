"""Builds the retail media tour's voiceover: one compressed MP3 per step from voiceover-script.json.

Text to speech is Kokoro-82M (Apache-2.0), run offline through the kokoro-onnx package with the
model files from its GitHub release (kokoro-v1.0.onnx, voices-v1.0.bin). Clips are only regenerated
when their text, voice, language, speed or model changes; everything else is reused.

    pip install kokoro-onnx soundfile
    python3 build_voiceover.py [--script voiceover-script.json] [--out tourart/vo] [--models DIR] [--force]

Writes <out>/<id>-<line>-<hash>.mp3 and <out>/manifest.json ({id: [{file, hash, text, duration, cue}]}).
Needs ffmpeg with libmp3lame on the PATH. Fails if any clip runs to 10 seconds or more."""
import argparse, hashlib, json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('--script', default=os.path.join(HERE, 'voiceover-script.json'))
ap.add_argument('--out', default=os.path.join(HERE, 'tourart', 'vo'))
ap.add_argument('--models', default=os.environ.get('KOKORO_DIR', os.path.join(HERE, '..', 'kokoro')))
ap.add_argument('--force', action='store_true', help='regenerate every clip')
ap.add_argument('--max-seconds', type=float, default=10.0)
args = ap.parse_args()

MODEL = os.path.join(args.models, 'kokoro-v1.0.onnx')
VOICES = os.path.join(args.models, 'voices-v1.0.bin')
for f in (MODEL, VOICES):
    if not os.path.exists(f):
        sys.exit(f'Missing {f}. Download it from https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0')

script = json.load(open(args.script, encoding='utf-8'))
voice, lang, speed = script['voice'], script.get('lang', 'en-us'), float(script.get('speed', 1.0))
os.makedirs(args.out, exist_ok=True)
man_path = os.path.join(args.out, 'manifest.json')
manifest = json.load(open(man_path, encoding='utf-8')) if os.path.exists(man_path) else {}

def sha(path):  # identifies the model build, so a model upgrade regenerates everything
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''): h.update(chunk)
    return h.hexdigest()[:16]
model_id = sha(MODEL) + sha(VOICES)

ids = [s['id'] for s in script['steps']]
assert len(ids) == len(set(ids)), 'duplicate step ids in the script'
old_by_hash = {l['hash']: l for lines in manifest.values() if isinstance(lines, list) for l in lines}
kokoro = None
made, kept, new = [], 0, {}
for s in script['steps']:
    out = []
    for n, line in enumerate(s['lines'], 1):
        text = ' '.join(line['text'].split())
        key = hashlib.sha1('|'.join([model_id, voice, lang, str(speed), text]).encode()).hexdigest()[:10]
        old = old_by_hash.get(key)
        if not args.force and old and os.path.exists(os.path.join(args.out, old['file'])):   # same words, same voice: reuse
            out.append({**old, 'cue': line.get('cue')}); kept += 1; continue
        if kokoro is None:
            from kokoro_onnx import Kokoro
            kokoro = Kokoro(MODEL, VOICES)
        import soundfile as sf
        samples, rate = kokoro.create(text, voice=voice, speed=speed, lang=lang)
        dur = round(len(samples) / rate, 2)
        if dur >= args.max_seconds:
            sys.exit(f"{s['id']} line {n} runs {dur}s, over {args.max_seconds}s: shorten it")
        name = f"{s['id']}-{n}-{key}.mp3"
        with tempfile.TemporaryDirectory() as tmp:
            wav = os.path.join(tmp, 'clip.wav'); sf.write(wav, samples, rate)
            # mono, 24 kHz, 48 kbps: clear speech at roughly 6 KB a second
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-af', 'afade=t=in:d=0.02', '-ac', '1', '-ar', '24000',
                            '-codec:a', 'libmp3lame', '-b:a', '48k', os.path.join(args.out, name)], check=True)
        out.append({'file': name, 'hash': key, 'text': text, 'duration': dur, 'cue': line.get('cue')})
        made.append(f"{s['id']}.{n} {dur}s")
    new[s['id']] = out
manifest = new
used = {l['file'] for lines in manifest.values() for l in lines}
for f in os.listdir(args.out):   # clips no longer in the script
    if f.endswith('.mp3') and f not in used: os.remove(os.path.join(args.out, f))
json.dump(manifest, open(man_path, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print(f'generated {len(made)}, unchanged {kept}')
for m in made: print('  ', m)
print('longest line', max(l['duration'] for v in manifest.values() for l in v), 's;', 'lines', sum(len(v) for v in manifest.values()))
