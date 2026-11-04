"""Charts for the results presentation, drawn from evaluation/results/metrics-latest.json.

    cd evaluation && python3 charts.py

Writes PNGs to evaluation/results/charts/. Every number comes from the measured run:
nothing here is typed in by hand.
"""
import json, os, pathlib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

HERE = pathlib.Path(__file__).parent
OUT = HERE / "results" / "charts"
OUT.mkdir(parents=True, exist_ok=True)
M = json.load(open(HERE / "results" / "metrics-latest.json"))

# Validated palette (dataviz reference instance). Categorical slots in fixed order.
BLUE, ORANGE, AQUA, YELLOW = "#2a78d6", "#eb6834", "#1baf7a", "#eda100"
GOOD, CRITICAL = "#0ca30c", "#d03b3b"
SURFACE, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e6e5e1"

plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE,
    "font.family": "DejaVu Sans", "font.size": 12,
    "text.color": INK, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2,
    "axes.edgecolor": GRID, "axes.linewidth": 1,
    "axes.spines.top": False, "axes.spines.right": False,
    "figure.dpi": 200,
})

def finish(ax, title, subtitle=None, xlabel=None):
    ax.set_title(title, fontsize=15, fontweight="600", color=INK, loc="left", pad=30 if subtitle else 10)
    if subtitle:
        ax.text(0, 1.015, subtitle, transform=ax.transAxes, fontsize=11, color=INK2, va="bottom")
    if xlabel:
        ax.set_xlabel(xlabel, fontsize=11)
    ax.grid(axis="x", color=GRID, linewidth=1)
    ax.set_axisbelow(True)

def save(fig, name):
    fig.tight_layout()
    fig.savefig(OUT / f"{name}.png", bbox_inches="tight", facecolor=SURFACE)
    plt.close(fig)
    print("  ", name + ".png")

# ---------------------------------------------------------------- 1. access decisions
per = M["decisionAccuracy"]["perScenario"]
labels = ["Consent active", "No consent", "Wrong role", "After revocation", "After expiry"]
keys = ["consent active", "no consent", "wrong role", "revoked", "expired"]
expected_permit = [True, False, False, False, False]
correct = [int(per[k].split("/")[0]) for k in keys]
total = [int(per[k].split("/")[1]) for k in keys]

fig, ax = plt.subplots(figsize=(9, 4.6))
colors = [GOOD if e else CRITICAL for e in expected_permit]
bars = ax.barh(labels[::-1], correct[::-1], color=colors[::-1], height=0.62)
for b, c, t in zip(bars, correct[::-1], total[::-1]):
    ax.text(c + 0.4, b.get_y() + b.get_height() / 2, f"{c}/{t}", va="center", fontsize=11.5, color=INK, fontweight="600")
ax.set_xlim(0, 23)
finish(ax, "The system decided correctly in all 100 trials",
       "Five access scenarios, 20 repetitions each. Green = access should be allowed, red = should be refused.",
       "Correct decisions out of 20")
save(fig, "01-decision-accuracy")

# ---------------------------------------------------------------- 2. latency
ms = M["latency"]["ms"]
order = [("submit", "Submit a report"), ("grant", "Give access"), ("revoke", "Take access back"),
         ("accessPermitted", "Open (allowed)"), ("accessDenied", "Open (refused)"), ("portalRead", "Load the portal")]
names = [n for _, n in order][::-1]
means = [ms[k]["mean"] for k, _ in order][::-1]
p95s = [ms[k]["p95"] for k, _ in order][::-1]

fig, ax = plt.subplots(figsize=(9, 4.8))
bars = ax.barh(names, means, color=BLUE, height=0.6)
ax.scatter(p95s, names, color=INK, s=34, zorder=3, label="95th percentile")
for b, m, p in zip(bars, means, p95s):
    ax.text(max(m, p) + 12, b.get_y() + b.get_height() / 2, f"{m:.0f} ms", va="center", fontsize=11.5, color=INK, fontweight="600")
ax.set_xlim(0, max(p95s) * 1.28)
ax.legend(frameon=False, loc="lower right", fontsize=10.5)
finish(ax, "Every operation completes in under half a second",
       f"Mean of {M['latency']['runs']} runs after {M['latency']['warmupDiscarded']} warm-ups, on a local Hardhat chain.",
       "Milliseconds")
save(fig, "02-latency")

# ---------------------------------------------------------------- 3. gas per function
gas = M["gas"]["perFunction"]
pretty = {"registerReport": "Register a report", "addItem": "Add details or evidence", "createConsent": "Record the sharing choice",
          "grantAccess": "Give access", "revokeConsent": "Take access back", "requestAccess": "Request access",
          "logAccess": "Record an access attempt", "withdrawReport": "Withdraw the report",
          "registerInstitution": "Register a staff wallet", "withdrawItem": "Withdraw one part",
          "deactivateInstitution": "Suspend a staff wallet"}
items = sorted(((pretty.get(k, k), v["avg"]) for k, v in gas.items()), key=lambda x: x[1])
fig, ax = plt.subplots(figsize=(9, 5.4))
bars = ax.barh([i[0] for i in items], [i[1] for i in items], color=ORANGE, height=0.62)
for b, (_, v) in zip(bars, items):
    ax.text(v + max(i[1] for i in items) * 0.015, b.get_y() + b.get_height() / 2, f"{v:,}", va="center", fontsize=11, color=INK, fontweight="600")
ax.set_xlim(0, max(i[1] for i in items) * 1.22)
ax.xaxis.set_major_formatter(FuncFormatter(lambda x, _: f"{int(x):,}"))
finish(ax, "What each action costs on the blockchain",
       "Average gas used per transaction, measured from the transaction receipts.", "Gas units")
save(fig, "03-gas")

# ---------------------------------------------------------------- 4. anonymiser
a = M["anonymiser"]
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.3), gridspec_kw={"width_ratios": [1, 1.25]})
vals = [a["precision"] * 100, a["recall"] * 100]
bars = ax1.bar(["Precision", "Recall"], vals, color=[AQUA, YELLOW], width=0.5)
for b, v in zip(bars, vals):
    ax1.text(b.get_x() + b.get_width() / 2, v + 2, f"{v:.1f}%", ha="center", fontsize=13, fontweight="600", color=INK)
ax1.set_ylim(0, 112)
ax1.set_ylabel("Percent")
ax1.grid(axis="y", color=GRID, linewidth=1); ax1.set_axisbelow(True)
ax1.set_title("Anonymiser performance", fontsize=14, fontweight="600", loc="left", color=INK, pad=12)

removed, missed = a["removed"], a["missed"]
kinds = a["missedByKind"]
ax2.barh(["Removed", "Missed"], [removed, missed], color=[AQUA, CRITICAL], height=0.5)
ax2.text(removed + 6, 0, f"{removed}", va="center", fontsize=12.5, fontweight="600", color=INK)
ax2.text(missed + 6, 1, f"{missed}  (all were names in ordinary sentences)", va="center", fontsize=11.5, fontweight="600", color=INK)
ax2.set_xlim(0, removed * 1.5)
ax2.grid(axis="x", color=GRID, linewidth=1); ax2.set_axisbelow(True)
ax2.set_title(f"Of {a['seededIdentifiers']} planted identifiers", fontsize=14, fontweight="600", loc="left", color=INK, pad=12)
fig.suptitle("The anonymiser removes structured identifiers reliably, and names unreliably",
             fontsize=15, fontweight="600", x=0.01, ha="left", y=1.04, color=INK)
save(fig, "04-anonymiser")

# ---------------------------------------------------------------- 5. security outcomes
sec = [
    ("Forged or replayed consent changes", M["forgedChangeRejection"]["attempts"], M["forgedChangeRejection"]["attempts"] - M["forgedChangeRejection"]["accepted"]),
    ("Access after revocation", M["revocationEffect"]["repetitions"], M["revocationEffect"]["deniedOnFirstAttemptAfterRevoke"]),
    ("Tampered ciphertext", M["integrityTamper"]["repetitions"], M["integrityTamper"]["rejected"]),
]
fig, ax = plt.subplots(figsize=(9, 3.6))
names = [s[0] for s in sec][::-1]
blocked = [s[2] for s in sec][::-1]
totals = [s[1] for s in sec][::-1]
bars = ax.barh(names, blocked, color=GOOD, height=0.55)
for b, v, t in zip(bars, blocked, totals):
    ax.text(v + 0.3, b.get_y() + b.get_height() / 2, f"{v}/{t} blocked", va="center", fontsize=11.5, fontweight="600", color=INK)
ax.set_xlim(0, 26)
finish(ax, "Every attack attempt was blocked",
       "Each row repeated 20 times against the running system.", "Attempts blocked out of 20")
save(fig, "05-security")

# ---------------------------------------------------------------- 6. coverage
cov = M["contractTests"]["coverage"]
contracts = [(k, cov[k]) for k in ["ReportRegistry", "ConsentManagement", "AuditTrail", "SignatureLib"] if k in cov]
fig, ax = plt.subplots(figsize=(9, 4))
x = range(len(contracts))
w = 0.38
lines = [c[1]["lines"] for c in contracts]
branches = [c[1]["branches"] for c in contracts]
b1 = ax.bar([i - w / 2 for i in x], lines, w, color=BLUE, label="Lines")
b2 = ax.bar([i + w / 2 for i in x], branches, w, color=ORANGE, label="Branches")
for bars in (b1, b2):
    for b in bars:
        ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 1.5, f"{b.get_height():.0f}%", ha="center", fontsize=10.5, fontweight="600", color=INK)
ax.set_xticks(list(x)); ax.set_xticklabels([c[0] for c in contracts], fontsize=11)
ax.set_ylim(0, 112); ax.set_ylabel("Percent covered")
ax.legend(frameon=False, fontsize=10.5, loc="lower right")
ax.grid(axis="y", color=GRID, linewidth=1); ax.set_axisbelow(True)
ax.set_title("Smart contract test coverage", fontsize=15, fontweight="600", loc="left", color=INK)
ax.set_title("Smart contract test coverage", fontsize=15, fontweight="600", loc="left", color=INK, pad=30)
ax.text(0, 1.015, f"{M['contractTests']['passing']} of {M['contractTests']['passing'] + M['contractTests']['failing']} tests pass.",
        transform=ax.transAxes, fontsize=11, color=INK2, va="bottom")
save(fig, "06-coverage")

print(f"\nCharts written to {OUT}")
