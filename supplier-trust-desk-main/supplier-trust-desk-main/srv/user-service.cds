@path: '/odata/v4/user'
service UserService @(requires: 'authenticated-user') {
  type Me { id : String; roles : many String; }
  function whoAmI() returns Me;
}
