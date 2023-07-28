'use strict';

console.log("hello world")

// Fetch a user from the GitHub API
fetch('https://api.github.com/users/georgedonnelly')
  .then((response) => {
    return response.json()
  })
  .then((data) => {
    console.log(data)
  })
  .catch((error) => {
    console.error(error)
  })