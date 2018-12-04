#!/usr/bin/env node
  
const yaml = require('yamljs');
const path = require('path');

let stack = yaml.load(path.resolve(__dirname, process.argv[2]));

const yamlPath = process.argv[3].split('.');

yamlPath.forEach((step) => {
  if( stack[step] )
    stack = stack[step];
  else
    process.exit(1);
});

console.log(stack);
