import React from "react";
import ItemRow from "./itemrow";

const Container = ({ data, copyText }) => {
  return (
    <div id="container">
      {Array.isArray(data) &&
        data.map((item) => (
          <ItemRow key={item.token.category} item={item} copyText={copyText} />
        ))}
    </div>
  );
};

export default Container;
