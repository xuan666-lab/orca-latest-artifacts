import { localizedApi } from "./i18n.mjs";
import { mount as shelf } from "./shelf/panel-mount.js";
import { mountView } from "./views.mjs";
const api = localizedApi(orca);
document.documentElement.lang = api.locale || "en";
await mountView(document.getElementById("artifacts"), "./shelf", shelf, api);
