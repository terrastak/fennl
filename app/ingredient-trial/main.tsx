import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/fonts.css";
import "../styles/tokens.css";
import "../styles/base.css";
import { IngredientTrial } from "./IngredientTrial";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <IngredientTrial />
  </StrictMode>,
);
