import { useEffect, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { useHideNutrition } from "../recipes/nutritionSetting";
import { useUnits } from "../recipes/units";
import { usePrintSet } from "../sync/useSync";
import { pageRule } from "./booklet";
import { usePrintOptions } from "./printOptions";
import { Printout } from "./Printout";
import styles from "./print.module.css";

/**
 * The recipe as printed, on its page only while the browser prints (phase F6), so printing from
 * the browser's own menu (Ctrl+P) prints the same clean recipe as Print does, with the saved
 * choices, instead of the screen with its menus and buttons. The recipe is read ahead, so it's
 * there the moment printing starts.
 */
export function PrintCopy({ id }: { id: string }) {
  const [options] = usePrintOptions();
  const [units] = useUnits();
  const [hideNutrition] = useHideNutrition();
  const set = usePrintSet([id], options.linked);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    // Synchronously, so the copy is on the page before the browser lays out what it prints.
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  if (!printing || !set || set.recipes.length === 0) return null;
  return createPortal(
    <div className={styles.copy} data-print-copy="">
      <style>{pageRule(options.layout)}</style>
      <Printout
        set={set}
        options={options}
        units={units}
        hideNutrition={hideNutrition}
        photoSize="full"
      />
    </div>,
    document.body,
  );
}
