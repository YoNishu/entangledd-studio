"""Prints the loudest pitch and the level of a media file's sound in a window: pitch.py file start seconds"""
import subprocess, sys, numpy as np
def sound(path, start, dur):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(dur), "-i", path, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(float) / 32768
def peaks(path, start=1.0, dur=2.0, n=2):
    x = sound(path, start, dur)
    if len(x) < 100: return [], 0.0
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))); freqs = np.fft.rfftfreq(len(x), 1 / 8000)
    out = []
    for _ in range(n):
        i = int(np.argmax(spec))
        if spec[i] < 0.02 * len(x) / 4: break
        out.append(int(round(freqs[i] / 10) * 10)); spec[max(0, i - 40): i + 40] = 0
    return out, round(float(np.sqrt(np.mean(x ** 2))), 3)
if __name__ == "__main__":
    print(peaks(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 1.0))
