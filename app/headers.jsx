const Headers = () => {
  const headers = [
    "Name",
    "Price",
    "Circulating Supply",
    "Max Supply",
    "Market Cap",
    "Category",
    "Links",
  ];

  return (
    <div id="headers" className="header-row">
      {headers.map((header) => (
        <div key={header} className="header">
          {header}
        </div>
      ))}
    </div>
  );
};

export default Headers;

