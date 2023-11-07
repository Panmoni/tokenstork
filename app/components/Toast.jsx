import React from "react";

import { ExclamationIcon } from "@heroicons/react/outline";
import { Callout } from "@tremor/react";

const Toast = ({ message }) => {
  return (
    <Callout
      className="h-12 bottom-10 border-primary absolute z-50 text-white bg-accent"
      title={message || "Copied to clipboard"}
      icon={ExclamationIcon}
    ></Callout>
  );
};

export default Toast;
