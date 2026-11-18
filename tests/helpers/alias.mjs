// import "./helpers/alias.mjs" first: lets a test import app modules that use "@/..." paths.
import { register } from "node:module";
register("./alias-hooks.mjs", import.meta.url);
