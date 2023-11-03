import React from "react";

const Toast = ({ message }) => {
  return (
    <div className={`${message ? "show" : ""}`}>
      {message || "Copied to clipboard"}
    </div>
  );
};

export default Toast;
