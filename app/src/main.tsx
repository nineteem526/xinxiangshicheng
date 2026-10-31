import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Game2 from "./Game2";
import PhoneCam from "./link/PhoneCam";
import "./styles.css";

// The same build serves two screens: the game (PC) and the minimal phone-camera page (?phone).
const isPhone = new URLSearchParams(location.search).has("phone");

createRoot(document.getElementById("root")!).render(<StrictMode>{isPhone ? <PhoneCam /> : new URLSearchParams(location.search).has("classic") ? <App /> : <Game2 />}</StrictMode>);


