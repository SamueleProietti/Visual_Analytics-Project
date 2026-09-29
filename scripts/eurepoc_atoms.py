"""Shared splitting rule for EuRepoC's semicolon-separated columns.

Both 00_verify_data.py and 01_preprocess.py must explode multi-valued cells exactly the
same way: if they disagree, the verified column counts stop describing the matrix that
is actually built. The rule lives here so there is only one of it.

The rule is not a plain `split(";")`. Some EuRepoC categories carry a parenthesised
explanation that itself contains a semicolon:

    "Long-term disruption (> 24h; incident scores 2 points in intensity)"

A naive split turns that single category into two nonsense ones - "Long-term disruption
(> 24h" and "incident scores 2 points in intensity)". It cost the `disruption` block two
phantom indicators before it was caught by eyeballing a decoded incident. Splitting only
at depth zero keeps the parenthetical intact.
"""

SEP = ";"


def split_atoms(value, default="Not available"):
    """Split one cell into its distinct atomic categories.

    Splits on `;` only outside parentheses, and returns a set - which also drops the
    within-row repetitions EuRepoC produces when it concatenates per-receiver values
    ("Disruption;Disruption", 23 rows). Binary indicators must stay binary.
    """
    if value is None:
        return {default}
    text = str(value)
    if not text.strip() or text.strip().lower() == "nan":
        return {default}

    atoms = set()
    depth = 0
    current = ""
    for char in text:
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(0, depth - 1)

        if char == SEP and depth == 0:
            if current.strip():
                atoms.add(current.strip())
            current = ""
        else:
            current += char

    if current.strip():
        atoms.add(current.strip())
    return atoms or {default}


def atom_counts(series, default="Not available"):
    """Count how many rows contain each atom (once per row, never twice)."""
    from collections import Counter

    counter = Counter()
    for value in series:
        for atom in split_atoms(value, default):
            counter[atom] += 1
    return counter
