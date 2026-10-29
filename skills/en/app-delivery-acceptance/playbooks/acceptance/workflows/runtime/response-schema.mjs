// The native structured submission uses the same field names as the plan gate.
export function runtimePlanSchema(spec){
 const strings={type:'array',items:{type:'string',minLength:1}},argv={...strings,minItems:1};
 const env={type:'object',additionalProperties:{type:'string'}};
 const command={type:'object',properties:{command:argv,cwd:{type:'string',minLength:1},env,timeout_seconds:{type:'integer',minimum:1,maximum:1800}},required:['command'],additionalProperties:false};
 const executable={type:'object',properties:{name:{type:'string',minLength:1},path:{type:'string',minLength:1},version_command:argv},required:['name','path','version_command'],additionalProperties:false};
 const keys=spec.data.inspection.knowledge_keys??Object.keys(spec.data.inspection.knowledge);
 const plan={type:'object',properties:{dependency_files:strings,knowledge_used:{type:'array',minItems:1,uniqueItems:true,items:{type:'string',enum:keys}},execution_env:env,setup_commands:{type:'array',items:command},executables:{type:'array',minItems:1,items:executable},smoke:command,recipe_candidate:{type:'string',minLength:1}},required:['dependency_files','knowledge_used','setup_commands','executables','smoke','recipe_candidate'],additionalProperties:false};
 return {anyOf:[plan,{type:'object',properties:{blocked_reason:{type:'string',minLength:1}},required:['blocked_reason'],additionalProperties:false}]};
}
