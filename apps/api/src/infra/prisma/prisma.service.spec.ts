import { connectionOptions } from './connection';

describe('connectionOptions', () => {
  it('parses host, port, credentials, database and pool size', () => {
    expect(
      connectionOptions(
        'mysql://smartschool:p%40ss%3Aword@127.0.0.1:3307/smartschooldb?connection_limit=5',
      ),
    ).toEqual({
      host: '127.0.0.1',
      port: 3307,
      user: 'smartschool',
      password: 'p@ss:word',
      database: 'smartschooldb',
      connectionLimit: 5,
    });
  });

  it('defaults the port and pool size', () => {
    expect(
      connectionOptions('mysql://root:root@db/smartschooldb_test'),
    ).toMatchObject({
      host: 'db',
      port: 3306,
      database: 'smartschooldb_test',
      connectionLimit: 10,
    });
  });
});
