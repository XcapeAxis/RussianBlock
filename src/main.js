import { RussianBlockApp } from "./ui/app.js";

const root = document.querySelector("#app");

if (!root) {
  throw new Error("App root element was not found.");
}

new RussianBlockApp(root);
