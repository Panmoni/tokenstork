import { useState } from "react";

import { ClipboardIcon } from "@heroicons/react/outline";
import { Icon } from "@tremor/react";

import Toast from "@/app/components/Toast";

type FormatCategoryProps = {
  category: string;
};

export default function FormatCategory({ category }: FormatCategoryProps) {
  const [toastMessage, setToastMessage] = useState("");

  function showToast(message: string) {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage("");
    }, 3000);
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    showToast("Category copied to clipboard");
  }

  const displayCategory =
    category.length > 10
      ? `${category.slice(0, 5)}...${category.slice(-5)}`
      : category;

  return (
    <>
      <a
        href={`https://explorer.salemkode.com/token/${category}`}
        target="_blank"
        rel="noopener noreferrer"
        title="View on SalemKode Explorer"
        className="font-mono"
      >
        {displayCategory}
      </a>
      <Icon
        icon={ClipboardIcon}
        size="sm"
        variant="simple"
        tooltip="Copy category to clipboard"
        onClick={() => copyText(category)}
        className="cursor-pointer align-middle hover:text-accent text-primary"
      />
      {toastMessage && <Toast message={toastMessage} />}
    </>
  );
}
