"""
Readable copies of the data, for inspection outside the application.

Writes data/tables/:

    eurepoc_global_dataset.csv                      3,414 x (4 numeric + 14 categorical)
    eurepoc_global_dataset_123_indicators.csv   3,414 x 123 binary indicators
    eurepoc_global_dataset_codebook_14_to_123.csv  indicator -> attribute and category
    Threat-Shape_tables.xlsx                        the same, plus the encoding explained
                                                    (only if openpyxl is installed)
    uncompressed/*.csv                              the .csv.gz artifacts of data/processed,
                                                    decompressed

The first table keeps the rows and the values of the EuRepoC release and only the 18
attributes the project uses. The 123 indicators are recomputed here from it with the rule
of 01_preprocess.py, and checked cell by cell against data/processed/features_matrix.csv.gz.

Run (needs data/raw/eurepoc_global_dataset_1_3.csv, see the README):
    .venv/Scripts/python scripts/12_export_tables.py
"""

import gzip
import shutil
import sys
from pathlib import Path

import pandas as pd

from eurepoc_atoms import split_atoms

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "eurepoc_global_dataset_1_3.csv"
PROC = ROOT / "data" / "processed"
OUT = ROOT / "data" / "tables"

# The 14 categorical attributes and the 4 numeric ones, as in 01_preprocess.py.
CATEGORICAL = [
    "incident_type", "mitre_initial_access", "mitre_impact", "functional_impact",
    "intelligence_impact", "cyber_conflict_issue", "offline_conflict_issue",
    "il_breach_indicator", "initiator_category", "state_responsibility_actor",
    "receiver_category", "data_theft", "disruption", "hijacking",
]
NUMERIC = ["weighted_intensity", "impact_indicator_score",
           "affected_entities_value", "affected_third_countries_value"]

EXCEL_CELL_LIMIT = 32767


def main():
    raw = Path(sys.argv[1]) if len(sys.argv) > 1 else RAW
    OUT.mkdir(parents=True, exist_ok=True)

    g = pd.read_csv(raw, low_memory=False)
    blocks = pd.read_csv(PROC / "feature_blocks.csv")
    matrix = pd.read_csv(PROC / "features_matrix.csv.gz")
    if len(g) != 3414 or not (g["incident_id"].to_numpy() == matrix["incident_id"].to_numpy()).all():
        raise SystemExit("the raw file does not match the matrix the application uses")

    # 1. the initial table
    initial = g[["incident_id"] + NUMERIC + CATEGORICAL].copy()
    for column in NUMERIC:
        initial[column] = pd.to_numeric(initial[column], errors="coerce")

    # 2. the 123 indicators, recomputed with the project's own splitting rule
    indicators = {"incident_id": g["incident_id"].to_numpy()}
    for _, b in blocks.iterrows():
        cells = g[b["source_column"]].apply(split_atoms)
        indicators[b["column"]] = cells.apply(lambda s, a=b["atom"]: int(a in s)).to_numpy()
    indicators = pd.DataFrame(indicators)
    onehot = [c for c in indicators.columns if c != "incident_id"]
    if len(onehot) != 123 or not (indicators[onehot].to_numpy() == matrix[onehot].to_numpy()).all():
        raise SystemExit("the recomputed indicators differ from features_matrix.csv.gz")

    # 3. the codebook
    codebook = blocks[["column", "source_column", "atom", "is_nullish"]].rename(columns={
        "column": "indicator", "source_column": "attribute", "atom": "category",
        "is_nullish": "missing_or_null_value"})
    codebook["incidents_with_1"] = [int(indicators[c].sum()) for c in codebook["indicator"]]

    per_attribute = codebook.groupby("attribute", sort=False).size().rename("indicators").reset_index()
    per_attribute["incidents_with_several_categories"] = [
        int((g[a].apply(split_atoms).apply(len) > 1).sum()) for a in per_attribute["attribute"]]

    initial.to_csv(OUT / "eurepoc_global_dataset.csv", index=False)
    indicators.to_csv(OUT / "eurepoc_global_dataset_123_indicators.csv", index=False)
    codebook.to_csv(OUT / "eurepoc_global_dataset_codebook_14_to_123.csv", index=False)

    # 4. the compressed artifacts, decompressed
    (OUT / "uncompressed").mkdir(exist_ok=True)
    for path in sorted(PROC.glob("*.csv.gz")):
        with gzip.open(path, "rb") as src, open(OUT / "uncompressed" / path.name[:-3], "wb") as dst:
            shutil.copyfileobj(src, dst)

    # 5. a workbook, for spreadsheet software that splits CSV files on ';'
    try:
        from openpyxl.styles import Font
    except ImportError:
        print("openpyxl not installed: the .xlsx workbook is skipped")
    else:
        # Excel holds at most 32,767 characters in a cell. One receiver_category cell is
        # longer, because EuRepoC repeats the category once per receiver; in the workbook
        # it keeps its distinct categories. The CSV keeps the original value.
        sheet = initial.copy()
        for column in CATEGORICAL:
            long = sheet[column].astype(str).str.len() > EXCEL_CELL_LIMIT
            sheet.loc[long, column] = sheet.loc[long, column].apply(
                lambda v: ";".join(sorted(split_atoms(v))))
        with pd.ExcelWriter(OUT / "Threat-Shape_tables.xlsx", engine="openpyxl") as xl:
            sheet.to_excel(xl, sheet_name="Initial table", index=False)
            indicators.to_excel(xl, sheet_name="123 indicators", index=False)
            codebook.to_excel(xl, sheet_name="Codebook 14-123", index=False)
            per_attribute.to_excel(xl, sheet_name="Per attribute", index=False)
            for ws in xl.sheets.values():
                ws.freeze_panes = "B2"
                for cell in ws[1]:
                    cell.font = Font(bold=True)

    print(per_attribute.to_string(index=False))
    print(f"\n{per_attribute['indicators'].sum()} indicators, identical to features_matrix.csv.gz")
    print(f"written to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
