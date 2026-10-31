import "./styles.css";

import { mountEditor } from "./editor";

const main = document.querySelector<HTMLElement>("#main")!;
mountEditor(main.querySelector<HTMLElement>(".panel__body")!);

// Files dropped outside the drop area would otherwise be opened by the browser
for (const type of ["dragover", "drop"]) {
  addEventListener(type, (event) => event.preventDefault());
}
