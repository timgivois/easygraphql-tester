'use strict'

const gql = require('graphql-tag')

function queryBuilder (doc) {
  // Get some properties of the query/mutation

  // Get the operation type like Query/Mutation
  const operationType = doc.operation ? doc.operation : null
  // Get the operation name that the user gave to the Query/Mutation
  const operationName = doc.name && doc.name.value ? doc.name.value : null

  // The result to return will be a custom object with multiple properties, used
  // to make some validations on the test.
  const parsedType = {
    operationType,
    operationName,
    queryVariables: [],
    arguments: [],
    fields: []
  }

  parsedType.queryVariables = doc.variableDefinitions.map(variable => {
    return {
      name: variable.variable.name.value
    }
  })

  const parsedTypes = []

  const selections = doc.selectionSet.selections ? doc.selectionSet.selections : null
  selections.forEach(element => {
    parsedType['queryName'] = getQueryName(element)
    parsedType['name'] = element.name.value
    parsedType.arguments = selectedArguments(element.arguments)
    parsedType.fields = element.selectionSet ? selectedFields(element.selectionSet.selections) : element.name.value
    // Should create a new object to prevent the new values replace the ones that
    // are already created.
    const newParsedType = Object.assign({}, parsedType)
    parsedTypes.push(newParsedType)
  })

  // this'll apply when there are multiples queries on one operation
  if (parsedTypes.length > 1) {
    return parsedTypes
  }

  return parsedType
}

function queryBuilderFromFragment (docs) {
  const parsedType = {
    operationType: null,
    operationName: null,
    queryVariables: [],
    arguments: [],
    fields: []
  }

  const doc = (docs.filter(doc => doc.kind === 'OperationDefinition'))[0]

  if (doc.operation) {
    parsedType.operationType = doc.operation
  }

  if (doc.name && doc.name.value) {
    parsedType.operationName = doc.name.value
  }

  if (doc.variableDefinitions) {
    parsedType.queryVariables = doc.variableDefinitions.map(variable => {
      return {
        name: variable.variable.name.value
      }
    })
  }

  if (doc.selectionSet && doc.selectionSet.selections) {
    doc.selectionSet.selections.forEach(element => {
      if (element.kind === 'FragmentSpread') {
        const filteredFragment = (docs.filter(doc => doc.name.value === element.name.value))[0]
        const nestedElement = filteredFragment.selectionSet.selections[0]

        parsedType['queryName'] = getQueryName(nestedElement)
        parsedType['name'] = nestedElement.name.value

        let fields = filteredFragment.selectionSet ? selectedFields(filteredFragment.selectionSet.selections, docs) : filteredFragment.name.value
        fields = (fields.filter(field => field.name === parsedType.name))[0]

        parsedType.arguments = selectedArguments(nestedElement.arguments)
        parsedType.fields = parsedType.fields.concat(fields.fields)
      } else {
        if (!parsedType['queryName']) {
          parsedType['queryName'] = getQueryName(element)
        }

        if (!parsedType['name']) {
          parsedType['name'] = element.name.value
        }

        const fields = element.selectionSet ? selectedFields(element.selectionSet.selections, docs) : element.name.value

        parsedType.arguments = selectedArguments(element.arguments)
        parsedType.fields = parsedType.fields.concat(fields)
      }
    })
  }
  return parsedType
}

function getQueryName (query) {
  if (query.alias && query.alias.value) {
    return query.alias.value
  }

  return query.name.value
}

function selectedArguments (args) {
  if (!args || args.length === 0) {
    return []
  }

  // Get the array of arguments on the query
  return args.map(arg => {
    return {
      name: arg.name.value,
      value: getArgValue(arg),
      type: arg.value.kind
    }
  })
}

function getArgValue (arg) {
  switch (arg.value.kind) {
    case 'EnumValue':
    case 'StringValue':
    case 'BooleanValue':
      return arg.value.value

    case 'ListValue':
      return arg.value.values

    case 'Variable':
      return arg.value.name.value

    case 'IntValue':
      return parseFloat(arg.value.value)

    // If the arg is an object, check if it has multiples values
    case 'ObjectValue':
      const argVal = arg.value.fields.map(arg => getArgValue(arg))
      return argVal.length === 1 ? argVal[0] : [].concat.apply([], argVal)

    default:
  }
}

// Loop the selected fields to get all the nested fields
function selectedFields (selections, docs, selected) {
  selected = []

  if (!selections) {
    return selected
  }

  selections.forEach(el => {
    const selection = {
      fields: [],
      arguments: []
    }

    if (el.kind === 'FragmentSpread') {
      const filteredFragment = (docs.filter(doc => doc.name.value === el.name.value))[0]
      const fields = selectedFields(filteredFragment.selectionSet.selections, docs, selected)
      return selected.push(...fields)
    }

    if (el.kind === 'InlineFragment') {
      selection['name'] = el.typeCondition.name.value
      selection['inlineFragment'] = true
    } else {
      selection['name'] = el.name.value
      // Add arguments to each type, so it can be validated against the schema type, and be sure
      // those arguments are used.
      selection.arguments = selection.arguments.concat(selectedArguments(el.arguments))
    }

    if (!el.selectionSet) {
      return selected.push(selection)
    }
    selection.fields = selectedFields(el.selectionSet.selections, docs, selected)
    selected.push(selection)
  })

  return selected
}

function queryParser (query, args) {
  let parsedQuery = null
  const graphQuery = gql`${query}`

  const isFragment = graphQuery.definitions.filter(definition => definition.kind === 'FragmentDefinition')

  if (graphQuery.definitions[0] || isFragment.length > 0) {
    if (isFragment.length > 0) {
      parsedQuery = queryBuilderFromFragment(graphQuery.definitions)
    } else {
      parsedQuery = queryBuilder(graphQuery.definitions[0])
    }

    // If it is a mutation, and there are arguments on the mutation operation and the
    // passed arguments are not an array, it should loop the arguments and set
    // the value of each argument in case the user is not using variables.
    if (parsedQuery.operationType === 'mutation') {
      let variables
      if (Array.isArray(parsedQuery.arguments) && !Array.isArray(args)) {
        const varsOnArguments = {}
        parsedQuery.arguments.forEach(arg => {
          if (arg.type !== 'Variable') {
            varsOnArguments[arg.name] = arg.value
          }
        })

        // The argument values will be replaced with the input value, in case there is one.
        variables = Object.assign({}, varsOnArguments, args)
      } else {
        variables = args
      }
      parsedQuery = Object.assign({ variables }, parsedQuery)
    }
  }

  return parsedQuery
}

module.exports = queryParser
