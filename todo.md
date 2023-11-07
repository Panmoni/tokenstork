## PENDING presentation issues

- check numbers again
-     rounding of numbers? line 90, 150 itemrow

- work on table colors
- alt row colors
- implement skeleton load
- Tremor is changing the font, fix that.
- what else can Tremor do for us?
- ticker in smaller font?
- add legend for number abbreviations

## Launch

- keep old one around on a different branch to check numbers
- compare load times of old and new

- sorting, default sort is TVL

## PENDING code issues

3. **Type Safety for JSON Responses**: Ensure the types for the API JSON responses are properly defined. Currently, the script assumes that the JSON response will match the expected structure. You should define interfaces for these responses to ensure type safety.
4. **TypeScript Types**: Use TypeScript interfaces or types to enforce the structure of the data you're expecting from each API.
5. **Data Validation After JSON Parsing**: There should be checks after parsing the JSON to ensure the data contains the expected fields before attempting to access them.

6. **Error Handling and Fallbacks**: When an API call fails, consider how this should affect the function's output. For non-critical data, you might provide a default value, whereas for critical data, it might be appropriate to throw an error. This decision should be based on how the data is used downstream.

// TODO: implement comprehensive error handling in getTokenData
// Consider what should happen if an API fails. Should the function continue with partial data, return null, or throw an error?
// After each API call, validate the response structure to ensure the data exists.

## Optimise Speed Ideas

To improve the performance of the `getTokenData` script, there are several strategies you could consider:

1. **Caching Responses**:
   If the data does not change often, you can cache the responses from your API calls and reuse the cache when the same requests are made. This would require a caching mechanism at either the server level or within your application code.

2. **Optimizing API Calls**:
   Review the API calls to ensure they are as efficient as possible. For example, if an API supports batch requests or if there are query parameters that can reduce the payload size, use them.

3. **Parallel Processing**:
   It looks like you're already using `Promise.all` to fetch data in parallel, which is great. Ensure that you use it wherever possible to avoid sequential processing.

4. **Selective Data Fetching**:
   Fetch only the necessary data. If the API provides a way to request specific fields, make use of it to minimize the amount of data transferred.

5. **Web Workers**:
   For intensive processing tasks, consider using Web Workers. This allows you to perform some of the processing in a background thread, keeping the main thread free for UI updates.

6. **Rate Limiting and Debouncing**:
   If `getTokenData` is called in response to user actions, implement rate limiting or debouncing to prevent unnecessary calls.

7. **Pagination or Lazy Loading**:
   If you're dealing with a large dataset, only load and process the data that is immediately necessary and fetch additional data as needed.

8. **Server-Side Processing**:
   Move as much processing as possible to the server side where it can be more efficient, and send only the final, processed data to the client.

9. **Optimizing Big Integer Operations**:
   Operations on big integers can be computationally expensive. If possible, optimize these operations or use libraries that handle big numbers more efficiently.

10. **Error Handling**:
    Implement a more comprehensive error handling strategy that can handle partial data or retry failed requests. This will help ensure that one failed request doesn't hold up the entire process.

By implementing these strategies, you should see an improvement in the script's execution time and overall efficiency.
