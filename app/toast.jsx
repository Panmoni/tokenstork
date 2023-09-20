import React from "react";

const Toast = ({ message }) => {
  return (
    <div id="toast" className={`toast ${message ? "show" : ""}`}>
      {message || "Copied to clipboard"}
    </div>
  );
};

export default Toast;
