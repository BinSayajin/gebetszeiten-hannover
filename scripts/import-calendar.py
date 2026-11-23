"""Convert an IKB Hannover annual PDF into the widget's offline calendar."""

import argparse
import json
import re
from datetime import date, timedelta
from pathlib import Path

import pdfplumber


DATE_CELL = re.compile(r"\d{2}\.\d{2}\.\d{4}\Z")
TIME_CELL = re.compile(r"(?:[01]\d|2[0-3]):[0-5]\d\Z")
COLUMNS = ("fajr", "shuruq", "thuhr", "asr1", "asr2", "maghrib", "isha", "haraj")


def extract_calendar(pdf_path):
    calendar = {}
    with pdfplumber.open(pdf_path) as document:
        for page in document.pages:
            for line in (page.extract_text() or "").splitlines():
                if not line.strip():
                    continue
                date_cell, *times = line.split()
                if not DATE_CELL.fullmatch(date_cell):
                    continue
                day, month, year = map(int, date_cell.split("."))
                day_key = date(year, month, day).isoformat()
                if day_key in calendar or len(times) not in (7, 8):
                    raise ValueError(f"Unerwartete Kalenderzeile auf Seite {page.page_number}: {line}")

                rows = {}
                for prayer, time in zip(COLUMNS, times):
                    if time == "--:--" and prayer in ("isha", "haraj"):
                        rows[prayer] = None
                    elif TIME_CELL.fullmatch(time):
                        rows[prayer] = time
                    else:
                        raise ValueError(f"Ungültige Zeit für {day_key}: {time}")
                calendar[day_key] = rows

    if not calendar:
        raise ValueError("Keine Kalendertabelle im PDF gefunden.")
    year = int(min(calendar)[:4])
    first_day = date(year, 1, 1)
    day_count = (date(year + 1, 1, 1) - first_day).days
    expected_keys = {(first_day + timedelta(days=i)).isoformat() for i in range(day_count)}
    if calendar.keys() != expected_keys:
        raise ValueError("Das PDF muss genau ein vollständiges Kalenderjahr enthalten.")
    return year, dict(sorted(calendar.items()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    args = parser.parse_args()
    year, calendar = extract_calendar(args.pdf)
    target = Path(__file__).resolve().parent.parent / "data" / f"hannover-{year}.json"
    target.parent.mkdir(exist_ok=True)
    lines = [f"  {json.dumps(day)}: {json.dumps(rows)}" for day, rows in calendar.items()]
    target.write_text("{\n" + ",\n".join(lines) + "\n}\n", encoding="utf-8")
    print(f"{target.name}: {len(calendar)} Tage")


if __name__ == "__main__":
    main()
