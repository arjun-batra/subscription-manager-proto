// Tests run in the user's zone, America/Toronto, so date and reminder maths cross real DST
// changes (Nov 1 2026, Mar 14 2027) on every machine, CI included. Workers inherit this.
module.exports = () => {
  process.env.TZ = 'America/Toronto';
};
